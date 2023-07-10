/**
 * Base class for a table used in the QueryBuilder.
 * Objects of this class should be joined first before
 * being passed into the 'from' function in QueryBuilder.
 * In short, joining will not be handled by the QueryBuilder
 * but by the tables directly.
 */
class Table {

    /**
     * Constructor for the class Table. Subclasses should
     * hardcode the arguments for 'name' and 'key' and have 
     * 'columns' as the parameter of its constructor.
     *
     * @param name name of the table
     * @param key primary key of the table
     * @param columns the columns that we are selecting from the table, can be left empty to select all. The columns should be written as a Javascript object, where the key is the column name and the value is the alias for the column
     */
    constructor(name, key, columns=[]) {
        this.name = name;
        this.key = key;
        this.columns = columns;
        this.joints = [];
    }

    getName() {
        return `\`${this.name}\``
    }

    getKey() {
        return `\`${this.key}\``;
    }

    getColumns() {
        return this.columns;
    }

    getJoints() {
        return this.joints;
    }

    /**
     * This Method cross joins two tables together. 
     * The method joins the two tables by comparing the given key and
     * the other table's primary key.
     * It is important to note that:
     * a.join(b, 'foreign key') is not the same as b.join(a, 'foreign key')
     *
     * @param other other table to be cross joined into this table
     * @param key the field used to join the other table.
     */
    join(other, key) {
        this.joints.push({'other': other, 'key': `\`${key}\``});
        return this;
    }
}

class Consignee extends Table {
    constructor(columns) {
        super('mConsignee', 'cCneeCode', columns);
    }
}

class STT extends Table {
    constructor(columns) {
        super('tSTT', 'cSTT', columns);
    }
}

class Shipper extends Table {
    constructor(columns) {
        super('mShipper', 'cShipCode', columns);
    }
}

class Session extends Table {
    constructor(columns) {
        super('tSession', 'cNumber', columns);
    }
}

class User extends Table {
    constructor(columns) {
        super('tUser', 'cNumber', columns);
    }
}

class Manifest extends Table {
    constructor(columns) {
        super('tManifest', 'cManifest', columns);
    }
}

export {
    Table,
    Consignee,
    STT,
    Shipper,
    Session,
    User,
    Manifest
}
