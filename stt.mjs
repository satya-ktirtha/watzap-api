import { executeBuilder } from './db.mjs';
import { STT, Consignee, Shipper } from './tables.mjs';
import QueryBuilder from './query.mjs';

/**
 * This function gets a single STT. The main table must be
 * an STT table.
 *
 * @param tables the stt table, joinable with other tables
 * @return a single stt from the database that corresponds to resi
 */
async function getSTT(resi, table) {
    try {
        const builder = new QueryBuilder();
        builder.select()
            .from(table)
            .whereEqual(table, 'cSTT', resi);
        const [sttList, fields] = await executeBuilder(builder);
        if(sttList.length === 0) {
            return false;
        }

        return sttList[0];
    } catch(e) {
        throw e;
    }
}

export {
    getSTT
}
