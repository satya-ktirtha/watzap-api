import mysql from 'mysql2/promise';
import session, { createSession, getSession, remakeSession, deleteSession, updateSessionData } from './session.mjs';
import { getSendHandler } from './handler.mjs';
import execute from './db.mjs';
import QueryBuilder from './query.mjs';
import { STT, Consignee, Session } from './tables.mjs';

class Test {

    constructor(name) {
        this.name = name;
        this.cases = [];
        this.mBefore = async () => {};
        this.mBeforeAll = async () => {};
        this.mAfter = async () => {};
        this.mAfterAll = async () => {};
    }

    addCase(testCase) {
        this.cases.push(testCase);
        return this;
    }

    before(f) {
        this.mBefore = async () => {
            await f();
        };
        return this;
    }

    after(f) {
        this.mAfter = async () => {
            await f();
        };
        return this;
    }

    beforeAll(f) {
        this.mBeforeAll = async () => {
            await f();
        };
        return this;
    }

    afterAll(f) {
        this.mAfterAll = async () => {
            await f();
        };
        return this;
    }

    async test() {
        console.log('Starting test:', this.name, '\n');
        if(this.cases.length === 0) {
            console.log("No test cases for test:", this.name);
            return;
        }
        await this.mBefore();
        for(const testCase of this.cases) {
            console.log("Running case:", testCase.name);
            await this.mBeforeAll();
            await testCase.test();
            await this.mAfterAll();
            console.log();
        }
        await this.mAfter();
        console.log('Test finished:', this.name);
    }
}

class Case {
    constructor(name, test) {
        if(test === undefined) {
            throw new Error("Nothing to be tested");
        }
        this.name = name;
        this.mTest = async () => await test();
        this.mBefore = async () => {};
        this.mAfter = async () => {};
    }

    before(f) {
        this.mBefore = async () => await f();
        return this;
    }

    after(f) {
        this.mAfter = async () => await f();
        return this;
    }

    async test() {
        await this.mBefore();
        const res = await this.mTest();
        await this.mAfter();
    }
}

async function call(f) {
    try {
        await f();
    } catch(e) {
        console.log(e);
    }
}

async function sessionTests() {
    const reportSession = {
        'number': 6281293893669,
        'type': 'report',
        'data': {
            'stage': 0,
            'stt': undefined,
            'details': {}
        }
    };

    const clearSession = async () => {
        try {
            await execute('DELETE FROM session WHERE number=?;', reportSession.number);
        } catch(e) {
            throw e;
        }
    };

    const sessionFunctionalities = new Test('Session functionalities')
                        .before(clearSession)
                        .after(clearSession)
                        .afterAll(async () => {
                                      const [rows, fields] = await getSession(reportSession.number);
                                      console.log(rows);
                                  }
                        );

    sessionFunctionalities.addCase(new Case("Reading session before creation", async () => {
        const [rows, fields] = await getSession(reportSession.number);
        return rows;
    }));
    sessionFunctionalities.addCase(new Case("Creating session", async () => {
        await createSession(reportSession);
    }));
    sessionFunctionalities.addCase(new Case("Modifying session", async () => {
        reportSession.data.stage = 1;
        reportSession.data.details.pengirim = 'john';
        await updateSession(reportSession);
    }))
    sessionFunctionalities.addCase(new Case("Removing session", async () => {
        await deleteSession({'number': reportSession.number});
    }));

    //await sessionFunctionalities.test();

    const userMessage = {
        "type": "incoming_chat",
        "data": {
            "chat_id": "XXXXXXXXX",
            "message_id": "XXXXXXXXX",
            "name": "6281293893669",
            "total_chat_unread": 0,
            "profile_picture": "https://example.com",
            "timestamp": Date.now(),
            "message_body": "1",
            "message_ack": "READ",
            "has_media": false,
            "media_mime": "",
            "media_name": "",
            "location_attached": {
                "lat": null,
                "lng": null
            },
            "is_forwading": false,
            "is_from_me": false
        }
    };

    const request = {
        'body': {
            'data': userMessage
        }
    };
    const response = {
        send: (msg) => {
            console.log(msg);
        }
    }

    const sessionSimulation = new Test('Session simulation')
                        .before(clearSession)
                        .after(clearSession)
                        .afterAll(async () => {
                                        if(request.session !== undefined) {
                                            console.log(request);
                                            delete request.session;
                                        }
                                }
                        );

    sessionSimulation.addCase(new Case("User started new session-less conversation (session creation)", async () => {
        await session(request, response, () => {});
    }));

    sessionSimulation.addCase(new Case("User answered within 5 minutes (session renew)", async () => {
        await session(request, response, () => {});
    }));

    sessionSimulation.addCase(new Case("User answered within 5 minutes (session update)", async () => {
        const [foundSessions, fields] = await getSession(userMessage.data.name);
        const session = foundSessions[0];
        request.session = await updateSessionData(session, {
            type: '1'
        });
    }));

    sessionSimulation.addCase(new Case("User answered after 5 minutes (session restart)", async() => {
        request.body.data.data.timestamp = Date.now() + 600000;
        await session(request, response, () => {});
    }))
    await sessionSimulation.test();
}

async function handlerTests() {
    const session = {
        'number': '6281293893669',
        'type': 0,
        'timestamp': new Date(Date.now()),
        'data': {}
    };

    const data = {
        "type": "incoming_chat",
        "data": {
            "chat_id": "XXXXXXXXX",
            "message_id": "XXXXXXXXX",
            "name": "6281293893669",
            "total_chat_unread": 0,
            "profile_picture": "https://example.com",
            "timestamp": Date.now(),
            "message_body": "1",
            "message_ack": "READ",
            "has_media": false,
            "media_mime": "",
            "media_name": "",
            "location_attached": {
                "lat": null,
                "lng": null
            },
            "is_forwading": false,
            "is_from_me": false
        }
    };

    const handler = getReportHandler();
    await handler.handle(session, data.data);

    data.data.message_body = "stt sample";
    await handler.handle(session, data.data);
    console.log(session);
}

function queryBuilderTests() {

    function showQuery(builder) {
        const {query, conditions} = builder.build();
        console.log(query, conditions);
    }

    let builder = QueryBuilder.start();

    const queryTests = new Test('query creation tests')
                            .afterAll(() => {
                                showQuery(builder);
                                builder = QueryBuilder.start();
                            });

    /*
     * Test case for selecting all from table stt. The same applies to any other
     * table.
     */
    queryTests.addCase(new Case("Selecting all from table stt", () => {
        const stt = new STT();
        builder.select().from(stt);
    }));

    /*
     * Test case for selecting specific columns, giving aliases from table stt.
     */
    queryTests.addCase(new Case("Selecting specific columns from table stt", () => {
        const stt = new STT({
            'cSTT': 'custom name for cSTT',
            'cCneeName': 'custom name for cCneeName'
        });

        builder.select().from(stt);
    }));

    /*
     * Test case for selecting all from table stt where cSTT equal 123.
     */
    queryTests.addCase(new Case("Selecting all from table stt where cSTT equal 123", () => {
        const stt = new STT();

        builder.select().from(stt).whereEqual(stt, 'cSTT', 123);
    }));

    /*
     * Test case for joining two tables, using the stt and consignee table.
     */
    queryTests.addCase(new Case("Joining the stt table with the consignee table using cCneeCode where cSTT equal 123", () => {
        const stt = new STT({
            'cSTT': 'stt'
        });
        const consignee = new Consignee();

        stt.join(consignee, 'cCneeCode');

        builder.select().from(stt).whereEqual(stt, 'cSTT', 123);
    }));

    /*
     * Test case for updating a record from the stt table.
     */
    queryTests.addCase(new Case("Updating stt table with new values for cCneeName and dPickUp where cSTT equal 123", () => {
        const stt = new STT({
            "cCneeName": "new consignee name",
            "dPickUp": "new pickup date"
        });

        builder.update().set(stt).whereEqual(stt, 'cSTT', 123);
    }));

    /*
     * Test case for inserting a new record into session table
     */
    queryTests.addCase(new Case("Inserting a new record into session table", () => {
        const session = new Session({
            'cNumber': 'number',
            'cOperatorKey': 'number_key',
            'dTimestamp': 'timestamp'
        });

        builder.insert().into(session);
    }));

    /*
     * Test case for deleting a record from session table
     */
    queryTests.addCase(new Case("Deleting from session table where cNumber equal 123", () => {
        const session = new Session();
        builder.delete().from(session).whereEqual(session, 'cNumber', '123');
    }));

    queryTests.test();
}

async function main() {
    call(async () => {
        queryBuilderTests();
    });
}

main();
