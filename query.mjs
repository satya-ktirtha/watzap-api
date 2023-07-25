/**
 * Base class for the states used in QueryBuilder.
 */
class QueryState {
    /**
     * Constructor for QueryState.
     *
     * @param table the table that is queried
     * @param conditions the conditions set for the query
     */
    build(table, conditions) {
        throw new Error("Must override in subclass");
    }
}

/**
 * Concrete class of QueryState. This class builds a 
 * select query with the given table and conditions.
 */
class SelectState extends QueryState {
    build(table, conditions) {
        let columns = "";
        let where = "";
        let from = "";
        let on = "";
        let crosses = "";

        const compileTable = (table) => {
            let currentName = `${table.getName()} AS ${table.getAlias()}`;

            const keys = Object.keys(table.getColumns());
            if(columns !== "") {
                columns += ",";
            }
            let temp = `${table.getAlias()}.*`;
            for(const column of keys) {
                if(temp === `${table.getAlias()}.*`) {
                    temp = `${table.getAlias()}.\`${column}\` AS \`${table.getColumns()[column]}\``;
                } else {
                    temp += `,${table.getAlias()}.\`${column}\` AS \`${table.getColumns()[column]}\``;
                }
            }

            columns += temp;

            if(table.getLeftJoints().length > 0) {
                for(const leftJoint of table.getLeftJoints()) {
                    currentName += ` LEFT JOIN ${compileTable(leftJoint.other)} ON ${table.getAlias()}.${leftJoint.key}=${leftJoint.other.getAlias()}.${leftJoint.other.getKey()}`;
                }
            }

            if(table.getJoints().length > 0) {
                for(const joint of table.getJoints()) {
                    const other = joint.other;
                    const otherName = compileTable(other);

                    crosses += ` CROSS JOIN ${otherName}`;

                    if(where !== "") {
                        where += ' AND';
                    }
                    where += ` ${table.getAlias()}.${joint.key}=${other.getAlias()}.${other.getKey()}`;
                }
            }

            return currentName;
        }

        const args = [];
        for(const condition of conditions) {
            args.push(condition.value);
            if(where !== "") {
                where += " AND ";
            }
            where += `${condition.table.getAlias()}.\`${condition.field}\`${condition.operator}?`
        }

        from = compileTable(table) + crosses;
        let query = `SELECT ${columns} FROM ${from}`;
        if(where !== "") {
            query += ` WHERE ${where}`;
        }

        return {
            'query': query,
            'conditions': args
        };
    }
}

/**
 * Concerete class of QueryState. This class builds
 * an insert statement with the given table columns and 
 * conditions. It is important to note that the key-value
 * pair of the table will be a (database column name)-(value)
 * pair.
 */
class InsertState {
    build(table, conditions) {
        const tableColumns = table.getColumns();
        const length = Object.keys(tableColumns).length;
        let questionMarks = "?";
        questionMarks += ",?".repeat(length - 1);

        const args = [];
        let columns = "";
        for(const column in tableColumns) {
            args.push(tableColumns[column]);
            if(columns !== "") {
                columns += ",";
            }
            columns += `\`${column}\``;
        }

        return {
            'query': `INSERT INTO ${table.getName()} (${columns}) VALUES (${questionMarks})`,
            'conditions': args
        }
    }
}

/**
 * Concrete class of QueryState. This class builds
 * an update statement with the given table columns
 * and conditions. It is important to note that the
 * key-value pair of the table will be a (database column name)-(new value)
 * pair.
 */
class UpdateState {
    build(table, conditions) {
        const args = [];
        const tableColumns = table.getColumns();
        let updateColumns = "";
        for(const column in tableColumns) {
            if(updateColumns !== "") {
                updateColumns += ",";
            }

            args.push(tableColumns[column]);
            updateColumns += `\`${column}\`=?`;
        }

        let where = "";
        for(const {table, field, value, operator} of conditions) {
            args.push(value);
            if(where !== "") {
                where += " AND ";
            }

            where += `${table.getName()}.\`${field}\`${operator}?`;
        }

        let query = `UPDATE ${table.getName()} SET ${updateColumns}`;
        if(where !== "") {
            query += ` WHERE ${where}`;
        }

        return {
            'query': query,
            'conditions': args
        };
    }
}

/**
 * Concrete class of QueryState. This class creates
 * a delete statement to delete a record from the
 * table. It is important to know that the columns passed
 * into the table is not used at all. Instead, the conditions
 * are used to specify a specific record.
 */
class DeleteState {
    build(table, conditions) {
        const args = [];
        let where = "";
        for(const {table, field, value, operator} of conditions) {
            args.push(value);
            if(where !== "") {
                where += ",";
            }

            where += `${table.getName()}.\`${field}\`${operator}?`;
        }

        let query = `DELETE FROM ${table.getName()}`
        if(where !== "") {
            query += ` WHERE ${where}`;
        }

        return {
            'query': query,
            'conditions': args
        }
    }
}

/**
 * This class builds a query accordng to its state.
 * To change states, use the 'select', 'insert', 'update'
 * methods. 
 * This class does not handle the joining of tables but
 * does handle the conditions for the where statement.
 *
 * This class currently supports only where statements.
 */
class QueryBuilder {

    /**
     * This class is not meant to be instantiated using
     * the new keyword. Instead, use the 'start' function.
     */
    constructor() {
        this.conditions = [];
    }

    /**
     * This method creates a QueryBuilder object
     */
    static start() {
        return new QueryBuilder();
    }

    /**
     * This method changes the state of this class to
     * build a select query.
     */
    select() {
        this.state = new SelectState();
        return this;
    }

    /**
     * This method changes the state of this class to
     * build an insert query.
     */
    insert() {
        this.state = new InsertState();
        return this;
    }

    /**
     * This method changes the state of this class to
     * build an update query.
     */
    update() {
        this.state = new UpdateState();
        return this;
    }

    delete() {
        this.state = new DeleteState();
        return this;
    }

    /**
     * This method adds a condition into the query.
     *
     * @param table the table that contains the field
     * @param field the field to be compared with the value
     * @param value the value to be compared with the field
     * @param operator the operator used to compare the field and value
     */
    where(table, field, value, operator) {
        this.conditions.push({
            table,
            field,
            value,
            operator
        });
    }

    /**
     * This method adds a condition that checks whether
     * the field is equals to the value.
     *
     * @param table the table that contains the field
     * @param field the field that should be equal to the value
     * @param value the value that should be equal to the field
     * @return the QueryBuilder object
     */
    whereEqual(table, field, value) {
        this.where(table, field, value, '=');
        return this;
    }

    /**
     * This method adds a condition that checks whether
     * the field is greater than the value.
     *
     * @param table the table that contains the field
     * @param field the field that should be greater than the value
     * @param value the value that should be less than the field
     * @return the QueryBuilder object
     */
    whereGreater(table, field, value) {
        this.where(table, field, value, '>');
        return this;
    }

    /**
     * This method adds a condition that checks whether
     * the field is less than the value.
     *
     * @param table the table that contains the field
     * @param field the field that should be less than the value
     * @param value the value that should be greater than the field
     * @return the QueryBuilder object
     */
    whereLesser(table, field, value) {
        this.where(table, field, value, '<');
        return this;
    }

    /**
     * This method adds a condition that checks whether
     * the field is greater than the value.
     *
     * @param table the table that contains the field
     * @param field the field that should be greater than or equal to the value
     * @param value the value that should be less than or equal to the field
     * @return the QueryBuilder object
     */
    whereGreaterEqual(table, field, value) {
        this.where(table, field, value, '>=');
        return this;
    }

    /**
     * This method adds a condition that checks whether
     * the field is less than or equal to  the value.
     *
     * @param table the table that contains the field
     * @param field the field that should be less than or equal to the value
     * @param value the value that should be greater than or equal to the field
     * @return the QueryBuilder object
     */
    wherelesserEqual(table, field, value) {
        this.where(table, field, value, '<=');
        return this;
    }

    /**
     * This method sets the table to get/delete data from. 
     * For selecting records, the key-value pair of the table
     * columns will be a (database column name)-(alias name) pair.
     * For deleting records, the key-value pair of the the table should
     * be left empty.
     * When using the from method with the select state, it is important
     * to note that the table's column names will be the alias names instead
     * of its actual name, given that aliases were given.
     *
     * @param table the table that will be selected or deleted 
     * @return the QueryBuilder object
     */
    from(table) {
        if(!(this.state instanceof SelectState || this.state instanceof DeleteState)) {
            throw new Error("Use from only when selecting or deleting from a table");
        } else if(this.state instanceof DeleteState) {
            if(table.getJoints().length > 0) {
                throw new Error("Deleting from database requires that the table is not joined with other tables");
            }
        }

        this.table = table;
        return this;
    }

    /**
     * This method sets the table to update a record in the database.
     * The key-value pair of the table will be a (database column name)-(value)
     * pair.
     *
     * @param table the table that will be updated
     */
    set(table) {
        if(!(this.state instanceof UpdateState)) {
            throw new Error("Use set only when updating a table");
        }
        if(table.getJoints().length > 0) {
            throw new Error("Updating a table requires that the table is not joined with other tables");
        }
        
        this.table = table;
        return this;
    }

    into(table) {
        if(!(this.state instanceof InsertState)) {
            throw new Error("Use insert only when inserting into a table");
        }

        if(table.getJoints().length > 0) {
            throw new Error("Updating a table requires that the table is not joined with other tables");
        }

        this.table = table;
        return this;
    }

    /**
     * This method builds the query to be used in a prepared statement. 
     * It returns a Javascript object containing the query and conditions.
     *
     * @return a Javascript object containing the query and conditions.
     */
    build() {
        return this.state.build(this.table, this.conditions);
    }
}


export default QueryBuilder;
