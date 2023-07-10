import execute from './db.mjs';
import { executeBuilder } from './db.mjs';
import QueryBuilder from './query.mjs';
import { Session, User } from './tables.mjs';
import { sendMessage } from './watzap.mjs';

const TABLE_NAME = 'tSession';

async function createSession(number, number_key, now) {
    try {
        const session = {
            'number': number,
            'timestamp': new Date(now),
            'number_key': number_key,
            'type': -1,
            'data': {}
        }

        const sessionTable = new Session({
            'cNumber': session.number,
            'cType': session.type,
            'dTimestamp': session.timestamp,
            'cOperatorKey': session.number_key,
            'cData': session.data
        })

        const builder = QueryBuilder.start();
        builder.insert()
            .into(sessionTable);

        await executeBuilder(builder);

        return session;
    } catch(e) {
        throw e;
    }
}

async function getSession(number) {
    try {
        const sessionTable = new Session({
            'cNumber': 'number',
            'cType': 'type',
            'cOperatorKey': 'number_key',
            'dTimestamp': 'timestamp',
            'cData': 'data'
        });

        const builder = QueryBuilder.start();
        builder.select()
            .from(sessionTable)
            .whereEqual(sessionTable, 'cNumber', number);

        const [sessions, fields] = await executeBuilder(builder);
        if(sessions.length === 0) {
            return false;
        }

        const session = {
            'number': sessions[0].number,
            'type': sessions[0].type,
            'number_key': sessions[0].number_key,
            'timestamp': sessions[0].timestamp,
            'data': sessions[0].data
        }

        return session;
    } catch(e) {
        throw e;
    }
}

async function remakeSession(number, number_key, timestamp) {
    try {
        const session = {
            'number': number,
            'type': -1,
            'number_key': number_key,
            'timestamp': new Date(timestamp),
            'data': {}
        }

        const sessionTable = new Session({
            'cNumber': session.number,
            'cType': session.type,
            'cOperatorKey': session.number_key,
            'dTimestamp': session.timestamp,
            'cData': session.data
        });

        const builder = QueryBuilder.start();
        builder.update()
            .set(sessionTable)
            .whereEqual(sessionTable, 'cNumber', number);

        await executeBuilder(builder);
        return session;
    } catch(e) {
        throw e;
    }
}

async function renewSession(session, now) {
    try {
        session.timestamp = new Date(now);

        const sessionTable = new Session({
            'cNumber': session.number,
            'cType': session.type,
            'cOperatorKey': session.number_key,
            'dTimestamp': session.timestamp,
            'cData': session.data
        });

        const builder = QueryBuilder.start();
        builder.update()
            .set(sessionTable)
            .whereEqual(sessionTable, 'cNumber', session.number);

        await executeBuilder(builder);

        return session;
    } catch(e) {
        throw e;
    }
}

/**
 * @deprecated It's the same as renewSession(). Will delete after removing usage.
 */
async function updateSessionData(session) {
    try {
        const sessionTable = new Session({
            'cNumber': session.number,
            'cType': session.type,
            'cOperatorKey': session.number_key,
            'dTimestamp': new Date(Date.now()),
            'cData': session.data
        });

        session.timestamp = new Date(Date.now());
        const statement = `UPDATE \`${TABLE_NAME}\` SET \`dTimestamp\`=?, \`cData\`=? WHERE \`cNumber\`=?;`;
        await execute(statement, session.timestamp,`${JSON.stringify(session.data)}`,`${session.number}`);
        return session;
    } catch(e) {
        throw e;
    }
}

async function deleteSession(number) {
    try {
        const sessionTable = new Session();

        const builder = QueryBuilder.start();
        builder.delete()
            .from(sessionTable)
            .whereEqual(sessionTable, 'cNumber', number);

        await executeBuilder(builder);
    } catch(e) {
        throw e;
    }
}

async function authenticate(req, number) {
    try {
        const user = new User({
            'cNumber': 'number',
            'cRole': 'role',
            'cName': 'name',
            'cCity': 'city'
        });
        const builder = QueryBuilder.start();
        builder.select()
            .from(user)
            .whereEqual(user, 'cNumber', number);

        const [users, fields] = await executeBuilder(builder);

        if(users.length === 1) {
            const user = users[0];
            req.body.user = {
                'name': user['name'],
                'role': user['role'],
                'city': user['city']
            };
            return true;
        }

        return false;
    } catch(e) {
        throw e;
    }
}

async function session(req, res, next) {
    try {
        req.body.data.timestamp = req.body.data.timestamp * 1000 + 7 * 60 * 60 * 1000;
        const data = req.body.data;

        if(data.is_from_me) {
            res.send({'status': 2})
        } else {
            if(!(await authenticate(req, data.name))) {
                await sendMessage({
                    'number_key': data.number_key,
                    'number': data.name
                }, 'Nomor anda tidak terdaftar');
                res.send({'status': 3});
            } else {
                const number = data.name;
                const currentSession = await getSession(number);
                if(!currentSession) {
                    req.session = await createSession(number, data.number_key, data.timestamp);
                    req.session.user = req.body.user;
                    next();
                } else {
                    const currentTimestamp = new Date(currentSession.timestamp).getTime();
                    const now = data.timestamp;
                    const difference = now - currentTimestamp;

                    // five minutes session expiry time
                    // TODO CHANGE HARD CODED DIFFERENCE
                    if(Math.abs(difference) > 600000) {
                        req.session = await remakeSession(currentSession.number, currentSession.number_key, data.timestamp);
                        await sendMessage(req.session, "Sesi anda diulang, respon terlalu lama");
                    } else {
                        req.session = await renewSession(currentSession, data.timestamp, data.timestamp);
                    }

                    req.session.user = req.body.user;

                    next();
                }
            }
        }
    } catch(e) {
        console.log(e);
        res.send({'status': -1});
    }
}

export default session;
export { 
    createSession,
    getSession,
    remakeSession,
    deleteSession,
    renewSession,
    updateSessionData
}
