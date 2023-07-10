import axios from 'axios';

async function execute(path, args) {
    const instance = axios.create({
        baseURL: 'https://api.watzap.id/v1',
        timeout: 30000,
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

export {
    sendMessage
}
