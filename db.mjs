import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

async function connect() {
    return await mysql.createConnection({
        host: process.env.DB_URL,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_SCHEMA
    });
}

async function execute(query, ...args) {
    const connection = await connect();
    try {
        const res = await connection.execute(query, args);
        await connection.end();

        return res;
    } catch(e) {
        await connection.end();
        throw e;
    }
}

async function executeBuilder(builder) {
    const connection = await connect();
    try {
        const {query, conditions} = builder.build();
        const res = await connection.execute(query, conditions);

        await connection.end();

        return res;
    } catch(e) {
        await connection.end();
        throw e;
    }
}

export default execute;
export {
    executeBuilder
};
