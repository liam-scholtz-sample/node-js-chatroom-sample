import { Server, Socket } from "socket.io";
import * as crypto from "crypto";

export enum E_Events {
    RequestError = 'request-error',
    Connected = 'connected',
    Disconnect = 'disconnect',
    UserJoined = 'user-joined',
    UserLeft = 'user-left',
    ChatMessage = 'chat-message',
}

interface I_Error {
    ErrorMessage: string,
}

export interface I_ConnectObject {
    readonly UserObject: I_UserEntry,
    readonly UserList: Array<I_UserEntry>,
    readonly MessageList: Array<I_MessageEntry>,
}

export interface I_UserEntry {
    readonly UserId: string,
    readonly UserName: string,
    readonly ConnectTimeStamp: Date,
}

export interface I_MessageEntry {
    readonly UserId: string,
    readonly MessageId: string,
    readonly SenderName: string,
    readonly MessageText: string,
    readonly TimeStamp: Date,
}

type T_RoomObject = {
    UserList: Array<I_UserEntry>,
    MessageList: Array<I_MessageEntry>,
}

type T_ChatObject = {
    [value in string]: T_RoomObject
};

function ForceDisconnect(socket: Socket, error: Error) {
    const DATA: I_Error = { ErrorMessage: 'An error has occured. You will be disconnected now. If this issue persists, please contact the developer.' };
    socket.emit(E_Events.RequestError, DATA);
    socket.disconnect();
    console.error(error);
}

const USERNAME_PATTERN = /.+/;
const MESSAGE_PATTERN = /.+/;
const TOKEN_PATTERN = /^[a-zA-Z0-9._-]{60}$/;

const TOKEN_LIST: Array<string> = JSON.parse(<any>process.env.ROOM_KEYS); // <-- ROOM ID's
console.log('TOKEN LIST', TOKEN_LIST);

const CHAT_OBJECT: T_ChatObject = (() => {
    const DATA: T_ChatObject = {};
    for (let i = 0; i < TOKEN_LIST.length; i++) {
        const ROOM_OBJECT: T_RoomObject = { UserList: [], MessageList: [] };
        DATA[TOKEN_LIST[i]] = ROOM_OBJECT;
    }
    return DATA;
})();

const PORT = <any>process.env.PORT || 7500;
const IO = new Server({
    cors: {
        origin: '*',
    },
});

IO.use((socket, next) => {
    try {
        const AUTH_TOKEN: string = socket.handshake.auth.AuthToken;
        if (!(AUTH_TOKEN) || !(typeof AUTH_TOKEN === 'string') || !(TOKEN_PATTERN.test(AUTH_TOKEN)))
            throw new Error('Auth token verification [Room ID] failed.');
        if (!(TOKEN_LIST.includes(AUTH_TOKEN)))
            throw new Error('Auth token [Room ID] does not exist on server.');
        const USERNAME: string = socket.handshake.auth.UserName;
        if (!(USERNAME) || !(typeof USERNAME === 'string') || !(USERNAME_PATTERN.test(USERNAME)))
            throw new Error('Username verification failed.');
        next();
    }
    catch (ex) {
        console.error('Error', ex);
        const ERROR = new Error((ex instanceof Error) ? ex.message : 'An unknown error has occured during user authorization. User rejected.');
        next(ERROR);
    }
});

IO.on('connection', (socket) => {
    const ROOM_ID = socket.handshake.auth.AuthToken;
    const USER_ID = (() => {
        let randomId: string;
        do { randomId = crypto.randomUUID(); }
        while (Object.values(CHAT_OBJECT).find(x => x.UserList.find(y => y.UserId === randomId)));
        return randomId;
    })();
    const CHAT = CHAT_OBJECT[ROOM_ID];
    const USER = {
        UserId: USER_ID,
        UserName: socket.handshake.auth.UserName,
        ConnectTimeStamp: new Date(),
    };
    CHAT.UserList.push(USER);

    socket.on(E_Events.Disconnect, () => {
        CHAT.UserList.splice(CHAT.UserList.indexOf(USER), 1);
        socket.to(ROOM_ID).emit(E_Events.UserLeft, USER);
        console.log(`User ${USER.UserName} has disconnected from room ${ROOM_ID}.`);
    });

    socket.on(E_Events.ChatMessage, async (params: { MessageText: string }) => {
        try {
            if (!(params) || !(params.MessageText) || !(typeof params.MessageText === 'string'))
                throw new Error(`${E_Events.ChatMessage} => Invalid input parameters.`);
            if (!(MESSAGE_PATTERN.test(params.MessageText)))
                throw new Error(`${E_Events.ChatMessage} => Message does not match the expected input pattern.`);
            const DATA: I_MessageEntry = {
                UserId: USER.UserId,
                MessageId: (() => {
                    let randomId: string;
                    do { randomId = crypto.randomUUID(); }
                    while (Object.values(CHAT_OBJECT).find(x => x.MessageList.find(y => y.MessageId === randomId)));
                    return randomId;
                })(),
                SenderName: USER.UserName,
                MessageText: params.MessageText,
                TimeStamp: new Date(),
            };
            CHAT.MessageList.push(DATA);
            IO.to(ROOM_ID).emit(E_Events.ChatMessage, DATA);
            console.log(`User ${USER.UserName} has sent a message: [${params.MessageText}]`);
        }
        catch (err) {
            ForceDisconnect(socket, err);
        }
    });

    const USER_DATA: I_ConnectObject = {
        UserObject: USER,
        UserList: Object.values(CHAT.UserList),
        MessageList: Object.values(CHAT.MessageList),
    };
    socket.join(ROOM_ID);
    socket.to(ROOM_ID).emit(E_Events.UserJoined, USER);

    socket.emit(E_Events.Connected, USER_DATA);
    console.log(`User ${USER.UserName} has connected to room ${ROOM_ID}.`);
});

IO.listen(PORT);
console.log('Server Status: Online');