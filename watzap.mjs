import axios from 'axios';
import path from 'path';

async function execute(path, args) {
    const instance = axios.create({
        baseURL: 'https://api.watzap.id/v1',
        timeout: 30000,
        maxBodyLength: Infinity,
        headers: {
            'Content-Type': 'application/json'
        }
    });

    try {
        await instance.post(path, args);
    } catch(e) {
        console.log(e);
        throw e;
    }
}

async function sendMessage(session, message) {
    await execute('/send_message', {
        'api_key': process.env.API_KEY,
        'number_key': session.number_key,
        'phone_no': session.number,
        'message': message
    });
}

async function sendFile(session, file) {
    const fileURL = path.join(process.env.DOMAIN_BASE, file);
    await execute('/send_file_url', {
        'api_key': process.env.API_KEY,
        'number_key': session.number_key,
        'phone_no': session.number,
        'url': fileURL
    });
}

async function notifyNumber(session, number, message) {
    await execute('/send_message', {
        'api_key': process.env.API_KEY,
        'number_key': session.number_key,
        'phone_no': number,
        'message': message
    })
}

export {
    sendMessage,
    sendFile,
    notifyNumber
}
