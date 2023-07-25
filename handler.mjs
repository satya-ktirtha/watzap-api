import axios from 'axios';
import geo from 'node-geo-distance';
import { getSTT } from './stt.mjs';
import { renewSession, deleteSession } from './session.mjs';
import { STT, Consignee, Shipper, Manifest, User, POD2, Supplier, AWB } from './tables.mjs';
import QueryBuilder from './query.mjs';
import { executeBuilder } from './db.mjs';
import { sendMessage, sendFile, notifyNumber } from './watzap.mjs';
import PDFDocumentWithTable from './pdf.mjs';
import fs from 'fs';
import path from 'path';

const ANTAR = 1;
const LINTAS = 2;
const JEMPUT = 3;

class Handler {

    constructor(field) {
        this.field = field;
    }

    async handle(session, data, child) {
        try {
            if(data.message_body.toUpperCase() === 'EXIT') {
                sendMessage(session, "Ketik MENU untuk mulai lagi");
                await deleteSession(session.number);
                return;
            }

            if(session.data[this.field] === undefined) {
                await this.notify(session);
                const sessionData = session.data;
                sessionData[this.field] = null;
                await renewSession(session, data.timestamp);
                return;
            } else if(session.data[this.field] === null) {
                const value = await child.check(session, data);
                if(value !== false) {
                    await child.update(session, data, value);
                } else {
                    await this.notify(session);
                    return;
                }
            }

            if(this.next !== undefined && this.next !== null) {
                await this.next.handle(session, data);
            }
        } catch(e) {
            throw e;
        }
    }

    async update(session, data, value) {
        session.data[this.field] = value;
        await renewSession(session, data.timestamp);
    }

    async notify(session) {
        await sendMessage(session, `${this.message}\natau ketik EXIT untuk berhenti`);
    }

    setNotification(message) {
        this.message = message;
    }

    setNext(next) {
        this.next = next;
    }
}

class BaseHandler extends Handler {
    constructor(field) {
        super(field);
    }

    async handle(session, data) {
       await super.handle(session, data, this);
    }
}

class DateTimeHandler extends BaseHandler {
    constructor(prompt) {
        super('date');

        this.prompt = prompt;
        this.setNotification(this.prompt + '\nFormat: MM/DD/YYYY HH:MM');
    }

    async update(session, data, value) {
        await super.update(session, data, value);
    }

    check(session, data) {
        const value = data.message_body;
        const timestamp = new Date(value).getTime();
        if(isNaN(timestamp) || new Date(value).toString() === "Invalid Date") {
            this.setNotification("Format tanggal dan waktu salah");
            return false;
        }

        return new Date(timestamp);
    }
}

class StringHandler extends BaseHandler {
    constructor(field, name, check=undefined) {
        super(field);

        this.name = name;
        this.customCheck = check || ((session, data, context) => data.message_body);
        this.prompt = `Ketik ${name}`;
        this.setNotification(this.prompt);
    }

    async check(session, data) {
        if(data.message_body.length === 0) {
            this.setNotification(`${this.name} tidak boleh kosong`);
            return false;
        }

        return await this.customCheck(session, data, this);
    }

    async update(session, data, value) {
        await super.update(session, data, value);
    }
}

class NumberHandler extends BaseHandler {
    constructor(field, name) {
        super(field);

        this.name = name;
        this.prompt = `Ketik ${name.toLowerCase()}`;
        this.setNotification(this.prompt);
    }

    check(session, data) {
        const value = parseInt(data.message_body);
        if(isNaN(value)) {
            this.setNotification(`${this.name} salah`);
            return false;
        }

        return value;
    }
}

class DecimalHandler extends BaseHandler {
    constructor(field, name, prompt) {
        super(field);

        this.name = name;
        if(!prompt) {
            this.prompt = `Ketik ${name.toLowerCase()}`;
        } else {
            this.prompt = prompt;
        }

        this.setNotification(this.prompt);
    }

    check(session, data) {
        const value = parseFloat(data.message_body);
        if(isNaN(value)) {
            this.setNotification(`${this.name} salah`);
            return;
        }
    }
}


class ListInputHandler extends BaseHandler {
    constructor(field, name, separator) {
        super(field);

        this.name = name;
        this.separator = separator;
        const msg = separator === "\n" ? "garis baru" : separator;
        this.setNotification(`Masukan ${name} (dipisah dengan ${msg})`)
    }

    check(session, data) {
        if(data.message_body.length === 0) {
            this.setNotification(`${this.name} tidak boleh kosong`);
            return false;
        }

        return data.message_body;
    }
    
    async update(session, data, value) {
        await super.update(session, data, value);
    }
}

class ChoiceHandler extends BaseHandler {
    constructor(name, choices) {
        super(name);

        this.choices = choices;
        this.menu = "";

        for(const i in this.choices) {
            this.menu += `${parseInt(i) + 1}. ${this.choices[i]}\n`;
        }

        this.setNotification(`Pilih salah satu:\n${this.menu}`);
    }

    check(session, data) {
        const value = parseInt(data.message_body);

        if(isNaN(value) || value < 1 || value > this.choices.length) {
            this.setNotification(`Pilihan salah, coba lagi:\n${this.menu}`);
            return false;
        }

        return value;
    }

    async update(session, data, value) {
        await super.update(session, data, value);
    }
}

class DriverHandler extends StringHandler {
    constructor() {
        super('driver', 'nomor hp supir (628xxxx)');
    }

    async check(session, data) {
        const number = await super.check(session, data);

        console.log('checking driver exist');
        const user = new User();
        const findUser = QueryBuilder.start()
                                      .select().from(user).whereEqual(user, 'cNumber', number);

        console.log(findUser.build().query, findUser.build().conditions);
        const [users, fields] = await executeBuilder(findUser);
        if(users.length !== 1) {
            console.log('driver does not exist');
            this.setNotification('Supir tidak ada');
            return false;
        }
            console.log('driver  exist');

        return number;
    }

    async update(session, data, value) {
        await super.update(session, data, value);
    }
}

class ManifestHandler extends StringHandler {
    constructor(options=null) {
        super('manifest_number', 'nomor manifest');

        if(options === null) {
            this.options = {
                'exists': false,
                'user': false,
                'save': false,
                'saveManifest': false
            }
        } else {
            this.options = {
                'exists': options.exists === undefined ? false : options.exists,
                'user': options.user === undefined ? false : options.user ,
                'save': options.save === undefined ? false : options.save,
                'saveManifest': options.saveManifest === undefined ? false : options.saveManifest
            }
        }
    }

    async check(session, data) {
        const manifest = await super.check(session, data);
        if(!manifest) {
            return false;
        }

        /*
         * Manifest format: yymmPOLPODiiiiit
         * 1: antar
         * 2: lintas
         * 3: jemput
         * Example for manifest number 00200 antar from jkt to jkt on 2023 July: 2307JKTJKT002001
         */
        if(manifest.length !== 'polpodtyymmddii'.length) {
            console.log("length error");
            this.setNotification('Format nomor manifest salah');
            return false;
        } 

        const locManifest = manifest.substring(0, 6);
        const typeManifest = parseInt(manifest.substring(6, 7));
        const dateManifest = manifest.substring(7, 13);
        const indexManifest = parseInt(manifest.substring(13));

        if(isNaN(dateManifest) || isNaN(indexManifest) || isNaN(typeManifest)) {
            console.log("nan error");
            this.setNotification('Format nomor manifest salah');
            return false;
        }

        if(typeManifest < 1 || typeManifest > 3) {
            console.log("type error");
            this.setNotification('Format nomor manifest salah');
            return false;
        }

        const getManifest = async () => {
            const manifestTable = new Manifest({
                'cSTT': 'stt',
                'cSupir': 'driver',
                'cKeterangan': 'keterangan',
                'dETA': 'eta',
                'cType': 'type',
                'dCreated': 'createDate',
                'cAWB': 'awb',
                'cPIC': 'pic'
            });

            const sttTable = new STT({
                'cShipName': 'shipper',
                'cCneeName': 'consignee',
                'nQty': 'quantity',
                'cPOL': 'pol',
                'cPOD': 'pod',
                'cCmdtDesc': 'description',
                'nGrWeight': 'actualWeight',
                'nChWeight': 'chargeWeight',
                'nVlWeight': 'volumeWeight',
                'nPanjang': 'panjang',
                'nLebar': 'lebar',
                'nTinggi': 'tinggi',
                'cStatusShpt': 'statusJemput',
                'cStatusCnee': 'statusAntar'
            });

            const userTable = new User({
                'cName': 'userName'
            }).setAlias('creator');

            const supirTable = new User({
                'cName': 'supirName'
            }).setAlias('supir')

            const pod2Table = new POD2({
                'cCityName': 'pod2'
            });

            const supplier = new Supplier({
                'cSuppName': 'supplier'
            });

            const awb = new AWB();

            sttTable.join(pod2Table, 'cPODdesc');

            manifestTable.join(sttTable, 'cSTT')
                         .join(userTable, 'cCreatedBy')
                         .join(supirTable, 'cSupir')
                         .leftJoin(awb.leftJoin(supplier, 'cAgenCode'), 'cAWB');

            const builder = QueryBuilder.start().select().from(manifestTable)
                                                .whereEqual(manifestTable, 'cTgl', dateManifest)
                                                .whereEqual(manifestTable, 'cLoc', locManifest)
                                                .whereEqual(manifestTable, 'cInd', indexManifest)
                                                .whereEqual(manifestTable, 'cType', typeManifest);

            const [list, fields] = await executeBuilder(builder);
            return list;
        }

        let res = null;
        if(this.options.exists) {
            if(res === null) {
                res = await getManifest();
            }

            console.log(res);
            if(res.length === 0) {
                this.setNotification("Manifest tidak ada");
                return false;
            }
        }

        if(this.options.user) {
            if(res === null) {
                res = await getManifest();
            }

            if(session.user.role !== 'ADMIN') {
                if(res[0].driver !== session.number) {
                    this.setNotification("Nomor hp anda tidak sesuai");
                    return false;
                }
            }
        }

        if(this.options.save) {
            if(res === null) {
                res = await getManifest();
            }

            session.data.manifestSTT = res;
            await renewSession(session, data.timestamp);
        }

        if(this.options.saveManifest) {
            if(res === null) {
                res = await getManifest();
            }

            if(res.length > 0) {
                session.data.driver = res[0].driver;
                session.data.keterangan = res[0].keterangan;
                session.data.date = res[0].eta;
                session.data.awb = res[0].awb;
                session.data.pic = res[0].pic;
                await renewSession(session, data.timestamp);
            }
        }

        return manifest;
    }
}

class MenuHandler extends BaseHandler {
    constructor(name, menu, prompt="Pilih salah satu") {
        super(name);
        this.name = name;
        this.menu = menu;

        const keys = Object.keys(this.menu);

        let choices = "";
        keys.forEach((v, i) => {
            choices += `${i + 1}. ${v}\n`;
        });

        this.initialMessage = `${prompt}:\n${choices}`;
        this.setNotification(this.initialMessage);
    }

    async handle(session, data) {
        if(data.message_body.toUpperCase() === 'EXIT') {
            sendMessage(session, "Ketik MENU untuk mulai lagi");
            await deleteSession(session.number);
            return;
        }

        try {
            if(session.data[this.field] === undefined) {
                await this.notify(session);
                const sessionData = session.data;
                sessionData[this.field] = null;
                await renewSession(session, data.timestamp);
            } else if(session.data[this.field] === null) {
                const choice = this.check(session, data);
                if(choice !== false) {
                    await this.update(session, data, choice);
                } else {
                    await this.notify(session);
                }
            } else {
                this.setNext(this.menu[Object.keys(this.menu)[parseInt(session.data[this.field])]]);
            }

            if(this.next !== undefined && this.next !== null) {
                await this.next.handle(session, data);
            }
        } catch(e) {
            throw e;
        }
    }

    async update(session, data, value) {
        await super.update(session, data, value);

        this.setNext(this.menu[Object.keys(this.menu)[value]]);
    }

    check(session, data) {
        const choice = parseInt(data.message_body);
        if(isNaN(choice) || choice < 1 || choice > Object.keys(this.menu).length) {
            this.setNotification(this.initialMessage);
            return false;
        }

        return choice - 1;
    }
}

/**
 * This class handles requests for getting a single
 * STT.
 */
class STTHandler extends BaseHandler {

    /**
     * The constructor of STTHandler takes in a 
     * parameter that represents the table to
     * be queried
     *
     * @param an STT table, joinable with other tables
     */
    constructor(table, formatString) {
        super('stt');

        if(!(table instanceof STT)) {
            throw new Error("An object of STT must be passed into the constructor of STTHandler");
        }

        this.setNotification("Ketik nomor STT");
        this.table = table;
        this.formatString = formatString;
    }
    constructSTT(input) {
        const inputLower = input.toLowerCase();
        const cityIndex = inputLower.search(/[a-z]{3}[0-9]/);
        if(cityIndex === -1) {
            return false;
        }

        const city = inputLower.substring(cityIndex, cityIndex + 3);
        const sttIndex = inputLower.substring(cityIndex + 3);

        const currentDate = new Date(Date.now());
        const currentYear = (currentDate.getFullYear() % 100).toString().padStart(2, '0');
        const currentMonth = (currentDate.getMonth() + 1).toString().padStart(2, '0');
        const previousMonth = (currentMonth - 1 === 0 ? 12 : currentMonth - 1).toString().padStart(2, '0');
        const previousYear = (currentMonth - 1 === 0 ? currentYear - 1 : currentYear).toString();

        if(sttIndex.match(new RegExp("00000")) || !sttIndex.match(new RegExp("[0-9]{5}"))) {
            return false;
        }
        if(cityIndex === 0) {
            return {
                'today': `${currentYear}${currentMonth}${city}${sttIndex}`,
                'yesterday': `${previousYear}${previousMonth}${city}${sttIndex}`
            };
        }

        const date = inputLower.substring(0, cityIndex);
        if(date.substring(0, 2) !== currentYear) {
            return false;
        }

        if(date !== `${currentYear}${currentMonth}` && date !== `${previousYear}${previousMonth}`) {
            return false;
        }

        return input;
    }


    async update(session, data, stt) {
        await super.update(session, data, stt);

        const sessionSTT = session.data.stt;
        let stt_string = this.formatString(sessionSTT);

        this.setNotification(stt_string);
        await this.notify(session);
    }

    async check(session, data) {
        /*
         * Format STT: (last 2 digits of year)(month)(city code)(index)
         * Example: 2307trc00001
         */
        const year = data.message_body.substring(0, 2);
        const month = data.message_body.substring(2, 4);
        const city = data.message_body.substring(4, 7);
        const index = data.message_body.substring(7);
        if(data.message_body.length !== 'yymmccciiiii'.length ||
            isNaN(year) ||
            isNaN(month) ||
            isNaN(index)) {

            this.setNotification('Nomor STT tidak lengkap atau salah');
            return false;
        }

        const stt = await getSTT(data.message_body, this.table);
        if(stt) {
            return stt;
        } else {
            session[`${this.field}_tries`] = session[`${this.field}_tries`] + 1;
            this.setNotification(`STT ${data.message_body} tidak ada`);
        }

        return false;
    }
}

/**
 * This class handles requests for getting the receiver of the
 * packaage.
 */
class ReceiverHandler extends BaseHandler {
    constructor(user) {
        super('receiver_name');

        this.setNotification(`Ketik nama ${user} paket`);
    }

    check(session, data) {
        const receiver = data.message_body;
        if(receiver === "") {
            this.setNotification("Nama penerima tidak boleh kosong");
        } else if(receiver.length > 20) {
            this.setNotification("Nama penerima terlalu panjang, maksimal 20 karakter");
        } else {
            return receiver;
        }

        return false;
    }

    async update(session, data, receiver) {
        await super.update(session, data, receiver);
    }
}

/**
 * This class handles requests for getting the status
 * of a package
 */
class PackageStatusHandler extends BaseHandler {
    constructor() {
        super('package_status');

        const choices = "1. Diterima\n2. Batal";
        this.initialMessage = "Pilih nomor untuk status paket:\n" + choices;
        this.setNotification(this.initialMessage);
    }

    check(session, data) {
        try {
            const choice = parseInt(data.message_body);
            if(choice < 1 || choice > 2) {
                this.setNotification("Pilihan salah\n" + this.initialMessage);
                return false;
            }

            if(choice === 1) {
                return "DITERIMA";
            } else if(choice === 2) {
                return "RETUR";
            }
        } catch(e) {
            this.setNotification("Pilihan salah\n" + this.initialMessage);
            return false;
        }
    }

    async update(session, data, value) {
        await super.update(session, data, value);
    }
}

/**
 * This class handles requests for getting consignee's
 * comments
 */
class CommentHandler extends BaseHandler {
    constructor(type, user) {
        super('comment');

        this.setNotification(`Ketik ${type} ${user} paket (maksimal 45 karakter)`);
    }

    check(session, data) {
        if(data.message_body.length > 45) {
            this.setNotification("Komentar terlalu panjang");
            return false;
        }

        return data.message_body;
    }
}

/**
 * This class handles request for getting the type of 
 * document (pickup, lintas, delivery)
 */
class DocumentTypeHandler extends BaseHandler {
    constructor() {
        super('document_type');

        const choices = "1. Pickup\n2. Lintas\n3. Delivery";
        this.initialMessage = "Select type of document:\n" + choices;
        this.setNotification(this.initialMessage);
    }

    check(session, data) {
        try {
            const choice = parseInt(data.message_body);
            if(choice < 1 || choice > 3) {
                this.setNotification("Invalid choice\n" + this.initialMessage);
                return false;
            }

            return choice;
        } catch(e) {
            this.setNotification("Invalid choice\n" + this.initialMessage);
            return false;
        }
    }

    async update(session, data, value) {
        await super.update(session, data, value);
    }
}

class DimensionHandler extends BaseHandler {
    constructor() {
        super('dimension');

        this.setNotification('Ketik PxLxT (cm):');
    }

    check(session, data) {
        return data.message_body;
    }
}

/**
 * This class handles what the program does at the
 * end of its function. There is no need to pass this
 * into the builder as one will be made automatically
 * if it isn't present.
 */
class EndHandler extends BaseHandler {

    /**
     * This is the constructor of the EndHandler class.
     *
     * @param handler a function that the EndHandler object will do
     */
    constructor(handler=(session,data) => {}) {
        super('');

        this.end = false;
        this.handler = handler;
    }

    setImmediateEnd(end) {
        this.end = true;
    }

    /**
     * This method does whatever method was passed into
     * the constructor and deletes the session afterwards. It
     * then notifies the user that the session has ended.
     */
    async handle(session, data) {
        // TODO handle when server error
        if(!this.end) {
            if(session.data.confirming === undefined) {
                await sendMessage(session, 'Submit?\n1. Iya\n2. Tidak');
                session.data.confirming = true;
                await renewSession(session, data.timestamp);
                return;
            }

            const choice = parseInt(data.message_body);
            if(isNaN(choice) || choice < 1 || choice > 2) {
                await sendMessage(session, 'Submit?\n1. Iya\n2. Tidak');
                return;
            }

            if(choice === 1) {
                await this.handler(session, data);
            }
        } else {
            await this.handler(session, data);
        }

        sendMessage(session, "Sesi anda sudah selesai, ketik MENU untuk mulai lagi");
        deleteSession(session.number);
    }
}


/**
 * This class creates a Chain of Responsibility program
 * that requests data from the user and builds it into
 * the session.
 */
class HandlerBuilder {

    static begin() {
        return new HandlerBuilder();
    }

    /**
     * This function adds a handler into the chain. The
     * inserted handler must not be an object of the
     * EndHandler class.
     *
     * @param handler a handler object
     */
    add(handler) {
        if(handler instanceof EndHandler) {
            throw new Error("An EndHandler object must not be passed as an argument. Use the endWith() method instead");
        }

        if(this.current !== null && this.current instanceof EndHandler) {
            throw new Error("Use the add() method before the endWith() method");
        }

        if(this.start == null) {
            this.start = handler;
            this.current = this.start;
        } else {
            this.current.setNext(handler);
            this.current = this.current.next;
        }

        return this;
    }

    /**
     * This method adds an EndHandler object to the end
     * of the chain that runs after the chain reaches its
     * end.
     *
     * @param handler a function that the EndHandler will do at the end of the chain
     */
    endWith(handler) {
        this.current.next = new EndHandler(handler);
        this.current = this.current.next;

        return this;
    }

    endImmediately(end) {
        if(this.current instanceof EndHandler) {
            this.current.setImmediateEnd(true);
        }

        return this;
    }

    /**
     * This function builds the entire chain, returning
     * the first handler of the chain. 
     *
     * @return the first handler that is in the chain
     */
    build() {
        return this.start;
    }
}

function getSendHandler() {
    const consignee = new Consignee({
        'cCneeName': 'consigneeName',
        'cAddress1': 'consigneeAddress',
        'cAddress2': 'consigneeAddress2',
        'cCity': 'consigneeCity',
        'cMobile': 'consigneeNumber'
    });
    const shipper = new Shipper({
        'cShipName': 'shipperName',
        'cMobile': 'shipperNumber'
    });
    const stt = new STT({
            'cSTT': 'stt',
            'cCmdtDesc': 'commodityDesc',
            'nChWeight': 'weight',
            'nQty': 'quantity',
        }).join(consignee, 'cCneeCode').join(shipper, 'cShipCode');

    const formatString = (sessionData) => {
        /*
         * NOMOR STT
         *
         * PENGIRIM 
         * HP 
         *
         * PENERIMA
         * ALAMAT
         * KABUPATEN/KOTA 
         * PROVINSI
         * HP
         *
         * QTY
         * BERAT
         * KOMODITI
         */
        let res = `Nomor STT: ${sessionData.stt}\n\n`;

        res += `PENGIRIM:\n${sessionData["shipperName"]}\n`
        res += `HP:\n${sessionData["shipperNumber"]}\n\n`
        res += `PENERIMA:\n${sessionData["consigneeName"]}\n`;
        res += `ALAMAT:\n${sessionData["consigneeAddress"]}\n`;
        res += `KABUPATEN/KOTA:\n${sessionData["consigneeAddress2"]}\n`;
        res += `PROVINSI:\n${sessionData["consigneeCity"]}\n`;
        res += `HP:\n${sessionData["consigneeNumber"]}\n\n`;
        res += `QTY:\n${sessionData["quantity"]}\n`;
        res += `BERAT:\n${sessionData["weight"]}\n`;
        res += `KOMODITI:\n${sessionData["commodityDesc"]}\n`;

        return res;
    }

    return HandlerBuilder.begin()
        .add(new STTHandler(stt, formatString))
        .add(new ReceiverHandler('penerima'))
        .add(new CommentHandler('komentar', 'penerima'))
        .add(new PackageStatusHandler())
        .endWith(async (session, data) => {
            const dataSTT = session.data.stt;
            const receiver = session.data.receiver_name;
            const status = session.data.package_status;
            const comment = session.data.comment;

            const builder = QueryBuilder.start();
            builder.update()
                .set(new STT({
                    'cCneeRecBy': receiver,
                    'dCneeRec': new Date(data.timestamp),
                    'cStatusCnee': status,
                    'cLastUser': session.user.name,
                    'dLastUpdated': new Date(data.timestamp),
                    'cCneeKom': comment
                }))
                .whereEqual(stt, 'cSTT', dataSTT.stt);

            await executeBuilder(builder);
            if(session.number === '6281293893669' || session.number === '6289656139959') {
                await notifyNumber(session, '6282114512888', `Notification utk shipper (nomor ${dataSTT.shipperNumber}).\nSupir ${session.user.name} telah antar paket dengan stt ${dataSTT.stt}.`)
                await notifyNumber(session, '6282114512888', `Notification utk consignee (nomor ${dataSTT.consigneeNumber}).\nSupir ${session.user.name} telah antar paket dengan stt ${dataSTT.stt}.`)
            }

        })
        .build();
}

function getFetchHandler() {
    const shipper = new Shipper({
        'cMobile': 'shipperNumber',
        'cAddress1': 'shipperAddress',
        'cAddress2': 'shipperAddress2',
        'cCity': 'shipperCity',
    });

    const consignee = new Consignee({
        'cMobile': 'consigneeNumber'
    });

    const stt = new STT({
        'cSTT': 'stt',
        'cCmdtDesc': 'commodityDesc',
        'cShipName': 'shipperName',
        'nChWeight': 'weight',
        'nQty': 'quantity',
    }).join(shipper, 'cShipCode').join(consignee, 'cCneeCode');

    const formatString = (sessionData) => {
        /*
         * NOMOR STT
         *
         * PENGIRIM 
         * ALAMAT
         * KABUPATEN/KOTA
         * PROVINSI
         * HP 
         *
         * QTY
         * BERAT
         * KOMODITI
         */
        let res = `Nomor STT: ${sessionData.stt}\n\n`;

        res += `PENGIRIM:\n${sessionData["shipperName"]}\n`;
        res += `ALAMAT:\n${sessionData["shipperAddress"]}\n`;
        res += `KABUPATEN/KOTA:\n${sessionData["shipperAddress2"]}\n`;
        res += `PROVINSI:\n${sessionData["shipperCity"]}\n`;
        res += `HP:\n${sessionData["shipperNumber"]}\n\n`;
        res += `QTY:\n${sessionData["quantity"]}\n`;
        res += `BERAT (kg):\n${sessionData["weight"]}\n`;
        res += `KOMODITI:\n${sessionData["commodityDesc"]}\n`;

        return res;
    };

    return HandlerBuilder.begin()
        .add(new STTHandler(stt, formatString))
        .add(new DimensionHandler())
        .add(new ReceiverHandler('pengirim'))
        .add(new CommentHandler('instruksi', 'pengirim'))
        .add(new PackageStatusHandler())
        .endWith(async (session, data) => {
            const dataSTT = session.data.stt;
            const receiver = session.data.receiver_name;
            const instruksi = session.data.comment;
            const status = session.data.package_status;
            const dimension = session.data.dimension;

            const builder = QueryBuilder.start();
            builder.update()
                .set(new STT({
                    'cShipRecBy': receiver,
                    'dShipRec': new Date(data.timestamp),
                    'cSpecialinstr': instruksi,
                    'cStatusShpt': status,
                    'cCargoDims': dimension
                }))
                .whereEqual(stt, 'cSTT', dataSTT.stt);

            await executeBuilder(builder);

            if(session.number === '6281293893669' || session.number === '6289656139959') {
                await notifyNumber(session, '6282114512888', `Notification utk shipper (nomor ${dataSTT.shipperNumber}).\nSupir ${session.user.name} telah jemput paket dengan stt ${dataSTT.stt}.`)
                await notifyNumber(session, '6282114512888', `Notification utk consignee (nomor ${dataSTT.consigneeNumber}).\nSupir ${session.user.name} telah jemput paket dengan stt ${dataSTT.stt}.`)
            }
        })
        .build();
}

function getCreateManifestHandler() {

    return HandlerBuilder.begin()
        .add(new ManifestHandler({
            'saveManifest': true
        }))
        .add(new ListInputHandler("stt_list", "list stt", "\n"))
        .add(new DateTimeHandler("Ketik ETA (tanggal dan waktu):"))
        .add(new StringHandler("keterangan", "keterangan"))
        .add(new StringHandler("awb", "awb"))
        .add(new StringHandler("pic", "pic"))
        .add(new DriverHandler())
        .endWith(async (session, data) => {
            sendMessage(session, "Mohon tunggu");
            const manifest = session.data.manifest_number.toUpperCase();
            const locManifest = manifest.substring(0, 6);
            const typeManifest = parseInt(manifest.substring(6, 7));
            const dateManifest = manifest.substring(7, 13);
            const indexManifest = parseInt(manifest.substring(13));
            const polManifest = locManifest.substring(0, 3);
            const podManifest = locManifest.substring(3);
            const sttData = session.data.stt_list.split('\n');
            const driver = session.data.driver;
            const keterangan = session.data.keterangan;
            // date is in mmddyyyy
            const ETA = session.data.date;
            const awb = session.data.awb;
            const pic = session.data.pic;

            let errMsg = "";
            const duplicates = [];
            const notFound = [];
            const wrongPorts = [];
            const success = [];

            /*
             * TODO
             *  MAKE MORE EFFICIENT BY
             *  CHANGING QUERYBUILDER TO SUPPORT AND, OR
             */
            const sttList = []; 
            for(const sttNumber of sttData) {
                const sttTable = new STT({
                    'cSTT': 'stt',
                    'cPOL': 'pol',
                    'cPOD': 'pod',
                    'cShipName': 'shipper',
                    'cCneeName': 'consignee',
                    'nQty': 'quantity',
                    'nChWeight': 'weight'
                });
                const consigneeTable = new Consignee({
                    'cMobile': 'consigneeNumber'
                });
                const shipperTable = new Shipper({
                    'cMobile': 'shipperNumber'
                });
                sttTable.join(consigneeTable, 'cCneeCode').join(shipperTable, 'cShipCode');
                const findStt = QueryBuilder.start()
                                            .select().from(sttTable)
                                            .whereEqual(sttTable, 'cSTT', sttNumber);

                const [res, fields] = await executeBuilder(findStt);
                if(res.length !== 1) {
                    notFound.push(sttNumber);
                } else {
                    sttList.push(res[0]);
                }
            }
            for(const stt of sttList) {
                if(stt === null) {
                    continue;
                }

                if(typeManifest === LINTAS) {
                    if(stt.pol !== polManifest || stt.pod !== podManifest) {
                        wrongPorts.push(stt);
                        continue;
                    }
                } else if(typeManifest === ANTAR) {
                    if(stt.pod !== podManifest) {
                        wrongPorts.push(stt);
                        continue;
                    }
                } else if(typeManifest === JEMPUT) {
                    if(stt.pol !== polManifest) {
                        wrongPorts.push(stt);
                        continue
                    }
                }

                try {
                    const insertManifest = new Manifest({
                        'cTgl': dateManifest,
                        'cLoc': locManifest,
                        'cInd': parseInt(indexManifest),
                        'cType': typeManifest,
                        'cSTT': stt.stt,
                        'cSupir': driver,
                        'dETA': new Date(ETA),
                        'cKeterangan': keterangan,
                        'cCreatedBy': session.number,
                        'cAWB': awb,
                        'cPIC': pic
                    });

                    const createManifest = QueryBuilder.start().insert().into(insertManifest);
                    const res = await executeBuilder(createManifest);
                    success.push(stt);

                    const shipperNumber = stt.shipperNumber;
                    const consigneeNumber = stt.consigneeNumber;

                } catch(e) {
                    if(e.code === 'ER_DUP_ENTRY') {
                        duplicates.push(stt.stt);
                    } else {
                        throw e;
                    }
                }
            }

            // TODO NOTIFY_MANIFEST 
            if(session.number === '6281293893669') {
                let notification = '';
                for(const stt of success) {
                    // TODO SEND NOTIF FOR EVERY STT SHIPPER, CONSIGNEE
                    notification += `${stt.stt}\n`;
                }
                await notifyNumber(session, '6282114512888', `Notification manifest creation. ${session.user.name} membuat manifest ${manifest} dengan stt:\n${notification}`)
            }

            if(duplicates.length > 0) {
                errMsg += "Duplicate entries:\n" + duplicates.join('\n') + '\n';
            }

            if(notFound.length > 0) {
                errMsg += "\nTidak ketemu:\n" + notFound.join('\n') + '\n';
            }

            if(wrongPorts.length > 0) {
                errMsg += "\nPOL/POD STT salah:\n";
                for(const stt of wrongPorts) {
                    errMsg += `${stt.stt} POL: ${stt.pol} POD: ${stt.pod}\n`;
                }
            }

            if(errMsg !== "") {
                await sendMessage(session, errMsg);
            }

        })
        .endImmediately()
        .build();
}

function getUpdateManifestHandler() {
    return HandlerBuilder.begin()
        .add(new ManifestHandler({
            'exists': true,
            'user': true,
            'save': false
        }))
        .add(new DateTimeHandler("Ketik ETA (tanggal dan waktu):"))
        .add(new StringHandler("keterangan", "keterangan"))
        .add(new DriverHandler())
        .endWith(async (session, data) => {
            const manifest = session.data.manifest_number.toUpperCase();
            const locManifest = manifest.substring(0, 6);
            const typeManifest = parseInt(manifest.substring(6, 7));
            const dateManifest = manifest.substring(7, 13);
            const indexManifest = parseInt(manifest.substring(13));
            const driver = session.data.driver;
            const keterangan = session.data.keterangan;
            const eta = session.data.date;

            const manifestTable = new Manifest({
                'cSupir': driver,
                'cKeterangan': keterangan,
                'dETA': new Date(eta)
            });

            const updateManifest = QueryBuilder.start().update().set(manifestTable)
                                            .whereEqual(manifestTable, 'cTgl', dateManifest)
                                            .whereEqual(manifestTable, 'cLoc', locManifest)
                                            .whereEqual(manifestTable, 'cInd', indexManifest)
                                            .whereEqual(manifestTable, 'cType', typeManifest);

            await executeBuilder(updateManifest);
        })
        .build();
}

function getAdminSTTHandler() {
    const updateField = async (session, data, field) => {
        const stt = new STT({
            field: session.data.value
        })

        const updateSTT = QueryBuilder.start().update().set(stt);

        await executeBuilder(updateSTT);
    };

    const STTUpdateMenu = {
        "Volume": HandlerBuilder.begin()
                            .add(new StringHandler('stt', 'nomor STT', async (session, data, context) => {
                                const stt = data.message_body;

                                const sttTable = new STT();
                                const findSTT = QueryBuilder.start()
                                                            .select()
                                                            .from(sttTable)
                                                            .whereEqual(sttTable, 'cSTT', stt);
                                const [ sttList, fields ] = await executeBuilder(findSTT);
                                if(sttList.length < 1) {
                                    context.setNotification('STT tidak ada');
                                    return false;
                                }

                                return sttList[0];
                            }))
                            .add(new StringHandler("dimensions", "dimensi (PxLxT)", (session, data, context) => {
                                const volumeList = data.message_body.split('x');
                                const panjang = volumeList[0];
                                const lebar = volumeList[1];
                                const tinggi = volumeList[2];

                                if(!panjang || !lebar || !tinggi) {
                                    context.setNotification('Format salah (PxLxT)');
                                    return false;
                                }

                                return {panjang, lebar, tinggi};
                            }))
                            .endWith(async (session, data) => {
                                const stt = session.data.stt;
                                const actualWeight = stt.nGrWeight;
                                const dimensions = session.data.dimensions;
                                const volume = dimensions.panjang * dimensions.lebar * dimensions.tinggi;
                                const vlWeight = volume / 4000;
                                const chWeight = Math.max(actualWeight, vlWeight);

                                const sttTable = new STT({
                                    'nPanjang': dimensions.panjang,
                                    'nLebar': dimensions.lebar,
                                    'nTinggi': dimensions.tinggi,
                                    'nVlWeight': vlWeight,
                                    'nChWeight': chWeight
                                })

                                const updateQuery = QueryBuilder.start()
                                                                .update()
                                                                .set(sttTable)
                                                                .whereEqual(sttTable, 'cSTT', stt.cSTT);

                                await executeBuilder(updateQuery);

                                const msg = `Gross Weight: ${actualWeight}\nVolume Weight: ${vlWeight}\nCharged Weight: ${chWeight}\n`;
                                await sendMessage(session, msg);
                            })
                            .build()

    }
    
    return HandlerBuilder.begin()
        .add(new MenuHandler("stt_menu", STTUpdateMenu))
        .build();
}

function getAdminHandler() {
    const adminMenu = {
        "Update STT": getAdminSTTHandler(),
        "Create/Add into Manifest": getCreateManifestHandler(),
        "Update Manifest": getUpdateManifestHandler()
    };

    return HandlerBuilder.begin()
        .add(new MenuHandler("initial_menu", adminMenu))
        .build();
}

function getManifestListHandler() {
    return HandlerBuilder.begin()
        .add(new ManifestHandler({
            'exists': true,
            'user': true,
            'save': true
        })) 
        .endWith(async (session, data) => {
            await sendMessage(session, "Mohon tunggu");
            const manifest = session.data.manifest_number;
            const locManifest = manifest.substring(0, 6);
            const typeManifest = parseInt(manifest.substring(6, 7));
            const dateManifest = manifest.substring(7, 13);
            const indexManifest = parseInt(manifest.substring(13));
            const sttList = session.data.manifestSTT;

            const sttTable = {
                complex: {
                    headers: [
                        { header: 'STT' },
                        { header: 'PENGIRIM' },
                        { header: 'POL' },
                        { header: 'POD' },
                        { header: 'KOMODITI' },
                        { header: 'PENERIMA' },
                        { header: 'QTY' },
                        { header: 'AWT' },
                        { header: 'VWT' },
                        { header: 'CWT' },
                        { header: 'AGENT' },
                        { header: 'PIC' }
                    ],
                    rows: []
                }
            }

            let res = "";
            let totalWeight = 0;
            let totalQuantity = 0;
            for(const sttObj of sttList) {
                /*
                 * Kalau manifest antar, check cStatusCnee 
                 * Kalau manifest jemput, check cStatusShpt
                 */

                if(parseInt(sttObj.type) === ANTAR) {
                    if(sttObj.statusAntar !== null) {
                        continue;
                    }
                } else if(parseInt(sttObj.type) === JEMPUT) {
                    if(sttObj.statusJemput !== null) {
                        continue;
                    }
                }

                totalWeight += parseInt(sttObj.actualWeight);
                totalQuantity += parseInt(sttObj.quantity);

                sttTable.complex.rows.push({
                    data: {
                        stt: `${sttObj.stt}`,
                        pengirim: `${sttObj.shipper || "-"}`,
                        pol: `${sttObj.pol || "-"}`,
                        pod: `${sttObj.pod2 || "-"}`,
                        komoditi: `${sttObj.description.replaceAll('\n', '') || "-"}`,
                        penerima: `${sttObj.consignee || "-"}`,
                        qty: `${sttObj.quantity.substring(0, sttObj.quantity.indexOf('.')) || "-"}`,
                        awt: `${sttObj.actualWeight?.substring(0, sttObj.actualWeight.indexOf('.')) || "-"}`,
                        vwt: `${sttObj.volumeWeight?.substring(0, sttObj.volumeWeight.indexOf('.')) || "-"}`,
                        cwt: `${sttObj.chargeWeight?.substring(0, sttObj.chargeWeight.indexOf('.')) || "-"}`,
                        agent: `${sttObj.supplier || "mjp"}`,
                        pic: `-`
                    }
                })
            }

            const creationDate = new Date(sttList[0].createDate);
            const creationYear = creationDate.getFullYear();
            const creationMonth = creationDate.getMonth();
            const creationDay = creationDate.getDate().toString().padStart(2, '0');

            const date = new Date(sttList[0].eta);
            const minutes = date.getMinutes().toString().padStart(2, '0');

            const pdf = new PDFDocumentWithTable({
                size: 'A4',
                layout: 'landscape',
                margins: {
                    top: 10,
                    bottom: 10,
                    left: 10,
                    right: 10 
                }
            });

            const months = ["Jan", "Feb", "Mar", "Apr", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

            const polManifest = locManifest.substring(3);
            const manifestTable = {
                complex: {
                    headers: [
                        { header: 'MANIFEST' },
                        { header: 'CREATED' },
                        { header: 'ETA' },
                        { header: 'TOTAL_QUANTITY' },
                        { header: 'TOTAL_WEIGHT' },
                        { header: 'DRIVER_1' },
                        { header: 'DRIVER_2' }
                    ],
                    rows: [
                        {
                            data: {
                                manifest: `${manifest}`,
                                created: `${sttList[0].userName} / ${creationDay} ${months[creationMonth - 1]} ${creationYear}`,
                                eta: `${date.getDate().toString().padStart(2, '0')} ${months[date.getMonth() - 1]} ${date.getFullYear()} ${date.getHours()}:${minutes}`,
                                total_quantity: `${totalQuantity}`,
                                total_weight: `${totalWeight} kg`,
                                driver_1: `${sttList[0].supirName}`,
                                driver_2: `-`
                            }
                        }
                    ]
                }
            }

            const driverTable = {
                complex: {
                    headers: [
                        { header: 'DRIVER_1' }
                    ], 
                    rows: [
                        {
                            data: {
                                driver_1: `${sttList[0].supirName}` 
                            }
                        }
                    ]
                }
            }

            pdf.pipe(fs.createWriteStream(path.join('public', `${manifest}.pdf`)));

            pdf.table(manifestTable, { reversed: true });
            pdf.image(path.join('public', 'mjp_logo.png'), 300, 50, { scale: 0.8} );
            pdf.table(sttTable, {});

            pdf.end();

            await sendFile(session, `${manifest}.pdf`);

            // TODO ERROR HANDLING HERE WHEN FILE FAILS TO BE DELETED
            fs.unlink(path.join('public', `${manifest}.pdf`), (err) => {
                if(err) {
                    console.log(err);
                }
            });
        })
        .endImmediately()
        .build();
}

async function handle(session, data) {
    /*
     * Getting user's action (anter, jemput, etc).
     * When adding or removing a menu item:
     * 1. Add appropriate menu list into choices
     * 2. Increase the check for the range of choice
     *
     * There is no need to change anything else
     */
    // Add or remove menu items here
    const choices = "1. Antar Barang\n2. Jemput Barang\n3. Lihat Manifest";
    const initialMessage = "Pilih salah satu:\n" + choices;

    if(session.type === -1) {
        if(data.message_body.toUpperCase() !== "MENU") {
            await sendMessage(session, "Ketik MENU untuk mulai");
        } else {
            await sendMessage(session, initialMessage);
            session.type = 0;
            await renewSession(session, data.timestamp);
        }
    } else if(session.type === 0) {
        const choice = parseInt(data.message_body);
        // Change the range for choice here
        if(!isNaN(choice) && choice === 0 && session.user.role === "ADMIN") {
            session.type = 100;
            await renewSession(session, data.timestamp);
        } else if(isNaN(choice) || choice < 1 || choice > 3) {
            await sendMessage(session, initialMessage);
        } else {
            session.type = choice;
            await renewSession(session, data.timestamp);
        }
    } 

    // Use appropriate handlers here
    // Change depending on needs
    if(session.type === 1) {
        await getSendHandler().handle(session, data);
    } else if(session.type === 2) {
        await getFetchHandler().handle(session, data);
    } else if(session.type === 3) {
        await getManifestListHandler().handle(session, data);
    } else if(session.type === 100) {
        await getAdminHandler().handle(session, data);
    }
}

export default handle;
export {
    getSendHandler
}
