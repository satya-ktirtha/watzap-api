import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import session, { deleteSession } from './session.mjs';
import handle from './handler.mjs';
import { sendMessage } from './watzap.mjs';

dotenv.config();
const app = express();

async function execute(path, args) {
    const instance = axios.create({
        baseURL: 'https://api.watzap.id/v1',
        headers: {
            'Content-Type': 'application/json'
        }
    });

    try {
        const result = await instance.post(path, args);
    } catch(e) {
        throw e;
    }
}

app.use(express.json());

app.post('/hook', session, async function(req, res) {
    const session = req.session;
    const data = req.body.data;

    try {
        await handle(session, data);

        res.send({'status': 0});
    } catch(e) {
        console.log(e);
        if(e.code === 'ECONNABORTED') {
            res.send({'status': -1});
        } else {
            await execute('/send_message', {
                'api_key': process.env.API_KEY,
                'number_key': data.number_key,
                'phone_no': data.name,
                'message': "There was a server error"
            })
            res.send({'status': -1});
        }
    }
})

app.listen(process.env.PORT, () => {
    console.log("App listening on port", process.env.PORT);
});
