let _teable_v2_core = require("@teable/v2-core");
let _teable_v2_di = require("@teable/v2-di");
let neverthrow = require("neverthrow");
let kysely = require("kysely");
let ts_pattern = require("ts-pattern");

//#region src/di/tokens.ts
const v2RecordRepositoryPostgresTokens = {
	db: Symbol("v2.adapter.recordRepositoryPostgres.db"),
	tableRecordQueryBuilderManager: Symbol("v2.adapter.recordRepositoryPostgres.tableRecordQueryBuilderManager")
};

//#endregion
//#region src/query-builder/FieldOutputColumnVisitor.ts
/**
* Visitor to collect field id -> output column alias mapping.
* Currently all fields use dbFieldName as the output alias,
* but this can be extended in the future for different field types.
*/
var FieldOutputColumnVisitor = class {
	columns = [];
	/**
	* Collect output column mappings for all fields in a table.
	*/
	collect(table) {
		return (0, neverthrow.safeTry)(function* () {
			for (const field of table.getFields()) yield* field.accept(this);
			return (0, neverthrow.ok)([...this.columns]);
		}.bind(this));
	}
	/**
	* Get the column alias for a single field.
	*/
	getColumnAlias(field) {
		return field.dbFieldName().andThen((dbFieldName) => dbFieldName.value());
	}
	addColumn(field) {
		return this.getColumnAlias(field).map((columnAlias) => {
			const column = {
				fieldId: field.id(),
				columnAlias
			};
			this.columns.push(column);
			return column;
		});
	}
	visitSingleLineTextField(field) {
		return this.addColumn(field);
	}
	visitLongTextField(field) {
		return this.addColumn(field);
	}
	visitNumberField(field) {
		return this.addColumn(field);
	}
	visitCheckboxField(field) {
		return this.addColumn(field);
	}
	visitDateField(field) {
		return this.addColumn(field);
	}
	visitSingleSelectField(field) {
		return this.addColumn(field);
	}
	visitMultipleSelectField(field) {
		return this.addColumn(field);
	}
	visitUserField(field) {
		return this.addColumn(field);
	}
	visitAttachmentField(field) {
		return this.addColumn(field);
	}
	visitCreatedTimeField(field) {
		return this.addColumn(field);
	}
	visitLastModifiedTimeField(field) {
		return this.addColumn(field);
	}
	visitAutoNumberField(field) {
		return this.addColumn(field);
	}
	visitCreatedByField(field) {
		return this.addColumn(field);
	}
	visitLastModifiedByField(field) {
		return this.addColumn(field);
	}
	visitRatingField(field) {
		return this.addColumn(field);
	}
	visitButtonField(field) {
		return this.addColumn(field);
	}
	visitFormulaField(field) {
		return this.addColumn(field);
	}
	visitLinkField(field) {
		return this.addColumn(field);
	}
	visitLookupField(field) {
		return this.addColumn(field);
	}
	visitRollupField(field) {
		return this.addColumn(field);
	}
};

//#endregion
//#region src/query-builder/computed/ComputedFieldSelectExpressionVisitor.ts
/** SQL aggregate functions for rollup */
const SqlAggregate = {
	COUNT: "COUNT",
	SUM: "SUM",
	AVG: "AVG",
	MAX: "MAX",
	MIN: "MIN",
	BOOL_AND: "BOOL_AND",
	BOOL_OR: "BOOL_OR",
	BOOL_XOR: "BOOL_XOR",
	STRING_AGG: "STRING_AGG",
	ARRAY_AGG: "ARRAY_AGG"
};
var ComputedFieldSelectExpressionVisitor = class {
	columnVisitor = new FieldOutputColumnVisitor();
	constructor(tableAlias, lateral) {
		this.tableAlias = tableAlias;
		this.lateral = lateral;
	}
	getColAlias(field) {
		return this.columnVisitor.getColumnAlias(field);
	}
	simpleColumn(field) {
		return this.getColAlias(field).map((colAlias) => kysely.sql`${kysely.sql.ref(`${this.tableAlias}.${colAlias}`)}`.as(colAlias));
	}
	visitSingleLineTextField(field) {
		return this.simpleColumn(field);
	}
	visitLongTextField(field) {
		return this.simpleColumn(field);
	}
	visitNumberField(field) {
		return this.simpleColumn(field);
	}
	visitCheckboxField(field) {
		return this.simpleColumn(field);
	}
	visitDateField(field) {
		return this.simpleColumn(field);
	}
	visitSingleSelectField(field) {
		return this.simpleColumn(field);
	}
	visitMultipleSelectField(field) {
		return this.simpleColumn(field);
	}
	visitUserField(field) {
		return this.simpleColumn(field);
	}
	visitAttachmentField(field) {
		return this.simpleColumn(field);
	}
	visitCreatedTimeField(field) {
		return this.simpleColumn(field);
	}
	visitLastModifiedTimeField(field) {
		return this.simpleColumn(field);
	}
	visitAutoNumberField(field) {
		return this.simpleColumn(field);
	}
	visitCreatedByField(field) {
		return this.simpleColumn(field);
	}
	visitLastModifiedByField(field) {
		return this.simpleColumn(field);
	}
	visitRatingField(field) {
		return this.simpleColumn(field);
	}
	visitButtonField(field) {
		return this.simpleColumn(field);
	}
	visitFormulaField(field) {
		return this.getColAlias(field).map((colAlias) => kysely.sql`NULL`.as(colAlias));
	}
	visitLinkField(field) {
		return this.getColAlias(field).map((colAlias) => {
			const isMultiValue = field.relationship().isMultipleValue();
			const lateralAlias = this.lateral.addColumn(field.id(), field.foreignTableId().toString(), colAlias, {
				type: "link",
				lookupFieldId: field.lookupFieldId(),
				isMultiValue
			});
			return kysely.sql`${kysely.sql.ref(`${lateralAlias}.${colAlias}`)}`.as(colAlias);
		});
	}
	visitLookupField(field) {
		return this.getColAlias(field).map((colAlias) => {
			const lateralAlias = this.lateral.addColumn(field.linkFieldId(), field.foreignTableId().toString(), colAlias, {
				type: "lookup",
				foreignFieldId: field.lookupFieldId()
			});
			return kysely.sql`${kysely.sql.ref(`${lateralAlias}.${colAlias}`)}`.as(colAlias);
		});
	}
	visitRollupField(field) {
		return this.getColAlias(field).map((colAlias) => {
			const aggregate = rollupExpressionToSqlAggregate(field.expression().toString());
			const lateralAlias = this.lateral.addColumn(field.linkFieldId(), field.foreignTableId().toString(), colAlias, {
				type: "rollup",
				foreignFieldId: field.lookupFieldId(),
				aggregate
			});
			return kysely.sql`${kysely.sql.ref(`${lateralAlias}.${colAlias}`)}`.as(colAlias);
		});
	}
};
/** Map RollupExpression to SQL aggregate function */
function rollupExpressionToSqlAggregate(expr) {
	return {
		"countall({values})": SqlAggregate.COUNT,
		"counta({values})": SqlAggregate.COUNT,
		"count({values})": SqlAggregate.COUNT,
		"sum({values})": SqlAggregate.SUM,
		"average({values})": SqlAggregate.AVG,
		"max({values})": SqlAggregate.MAX,
		"min({values})": SqlAggregate.MIN,
		"and({values})": SqlAggregate.BOOL_AND,
		"or({values})": SqlAggregate.BOOL_OR,
		"xor({values})": SqlAggregate.BOOL_XOR,
		"array_join({values})": SqlAggregate.STRING_AGG,
		"array_unique({values})": SqlAggregate.ARRAY_AGG,
		"array_compact({values})": SqlAggregate.ARRAY_AGG,
		"concatenate({values})": SqlAggregate.STRING_AGG
	}[expr] ?? SqlAggregate.ARRAY_AGG;
}

//#endregion
//#region src/query-builder/computed/ComputedTableRecordQueryBuilder.ts
const T$1 = "t";
const F = "f";
/**
* Query builder that computes field values using LATERAL joins and SQL expressions.
* Dynamically resolves link/lookup/rollup fields through database-side computation.
*/
var ComputedTableRecordQueryBuilder = class {
	table = null;
	projection = null;
	limitValue = null;
	offsetValue = null;
	foreignTables;
	constructor(db, options) {
		this.db = db;
		this.foreignTables = options?.foreignTables ?? /* @__PURE__ */ new Map();
	}
	from(table) {
		this.table = table;
		return this;
	}
	select(projection) {
		this.projection = projection;
		return this;
	}
	limit(n) {
		this.limitValue = n;
		return this;
	}
	offset(n) {
		this.offsetValue = n;
		return this;
	}
	/**
	* Prepare by loading foreign tables needed for link/lookup/rollup fields.
	*/
	async prepare(deps) {
		if (!this.table) return (0, neverthrow.err)(_teable_v2_core.domainError.validation({ message: "Call from() first" }));
		const table = this.table;
		return (0, neverthrow.safeTry)(async function* () {
			const refs = yield* new _teable_v2_core.LinkForeignTableReferenceVisitor().collect(table.getFields());
			if (refs.length === 0) {
				this.foreignTables = /* @__PURE__ */ new Map();
				return (0, neverthrow.ok)(void 0);
			}
			const foreignTables = /* @__PURE__ */ new Map();
			for (const ref of refs) {
				if (ref.foreignTableId.equals(table.id())) {
					foreignTables.set(ref.foreignTableId.toString(), table);
					continue;
				}
				const foreignSpec = yield* table.specs().byId(ref.foreignTableId).build();
				const foreignTable = yield* (await deps.tableRepository.findOne(deps.context, foreignSpec)).mapErr((error) => (0, _teable_v2_core.isNotFoundError)(error) ? _teable_v2_core.domainError.notFound({
					code: "foreign_table.not_found",
					message: `Foreign table not found: ${ref.foreignTableId.toString()}`
				}) : error);
				foreignTables.set(ref.foreignTableId.toString(), foreignTable);
			}
			this.foreignTables = foreignTables;
			return (0, neverthrow.ok)(void 0);
		}.bind(this));
	}
	build() {
		if (!this.table) return (0, neverthrow.err)(_teable_v2_core.domainError.validation({ message: "Call from() first" }));
		const table = this.table;
		const foreignTables = this.foreignTables;
		const projection = this.projection;
		const { laterals, ctx: lateralCtx } = this.createLateralContext();
		return (0, neverthrow.safeTry)(function* () {
			const tableName = yield* (yield* table.dbTableName()).value();
			const fieldSelectColumns = yield* this.buildSelectColumns(table, projection, lateralCtx);
			const applyLateralJoins = yield* this.buildLateralJoins(table, foreignTables, laterals);
			const selectColumns = [kysely.sql`${kysely.sql.ref(`${T$1}.__id`)}`.as("__id"), ...fieldSelectColumns];
			return (0, neverthrow.ok)(this.db.selectFrom(`${tableName} as ${T$1}`).select(() => selectColumns).$call(applyLateralJoins).$if(this.limitValue !== null, (qb) => qb.limit(this.limitValue)).$if(this.offsetValue !== null, (qb) => qb.offset(this.offsetValue)));
		}.bind(this));
	}
	createLateralContext() {
		const laterals = /* @__PURE__ */ new Map();
		return {
			laterals,
			ctx: { addColumn(linkFieldId, foreignTableId, outputAlias, columnType) {
				const key = linkFieldId.toString();
				if (!laterals.has(key)) laterals.set(key, {
					linkFieldId,
					alias: `lat_${key}`,
					foreignTableId,
					columns: []
				});
				laterals.get(key).columns.push({
					outputAlias,
					columnType
				});
				return laterals.get(key).alias;
			} }
		};
	}
	buildSelectColumns(table, projection, lateralCtx) {
		return (0, neverthrow.safeTry)(function* () {
			const visitor = new ComputedFieldSelectExpressionVisitor(T$1, lateralCtx);
			const columns = [];
			for (const field of table.getFields()) {
				if (projection && !projection.some((p) => p.toString() === field.id().toString())) continue;
				columns.push(yield* field.accept(visitor));
			}
			return (0, neverthrow.ok)(columns);
		});
	}
	buildLateralJoins(table, foreignTables, laterals) {
		if (laterals.size === 0) return (0, neverthrow.ok)((qb) => qb);
		return (0, neverthrow.safeTry)(function* () {
			const subqueries = [];
			for (const [, lateral] of laterals) {
				const foreignTable = foreignTables.get(lateral.foreignTableId);
				if (!foreignTable) return (0, neverthrow.err)(_teable_v2_core.domainError.notFound({ message: `Foreign table not found: ${lateral.foreignTableId}` }));
				const linkField = yield* table.getField((f) => f.id().equals(lateral.linkFieldId)).mapErr(() => _teable_v2_core.domainError.notFound({ message: `Link field not found: ${lateral.linkFieldId}` }));
				const foreignTableName = yield* (yield* foreignTable.dbTableName()).value();
				const selectExprs = [];
				for (const col of lateral.columns) selectExprs.push(yield* this.buildLateralSelectExpr(foreignTable, col.columnType, col.outputAlias));
				const joinCondition = yield* this.getJoinCondition(linkField, foreignTableName);
				subqueries.push(this.db.selectFrom(`${foreignTableName} as ${F}`).select(selectExprs).where(joinCondition).as(lateral.alias));
			}
			return (0, neverthrow.ok)((qb) => subqueries.reduce((q, sub) => q.innerJoinLateral(sub, (j) => j.onTrue()), qb));
		}.bind(this));
	}
	buildLateralSelectExpr(foreignTable, columnType, outputAlias) {
		return (0, ts_pattern.match)(columnType).with({ type: "link" }, ({ lookupFieldId, isMultiValue }) => this.getForeignColRef(foreignTable, lookupFieldId).map((titleRef) => {
			const jsonObj = kysely.sql`jsonb_strip_nulls(jsonb_build_object('id', ${kysely.sql.ref(`${F}.__id`)}, 'title', ${titleRef}))`;
			if (isMultiValue) return kysely.sql`json_agg(${jsonObj})`.as(outputAlias);
			else return kysely.sql`(json_agg(${jsonObj}))[0]`.as(outputAlias);
		})).with({ type: "lookup" }, ({ foreignFieldId }) => this.getForeignColRef(foreignTable, foreignFieldId).map((colRef) => kysely.sql`ARRAY_AGG(${colRef})`.as(outputAlias))).with({ type: "rollup" }, ({ foreignFieldId, aggregate }) => this.getForeignColRef(foreignTable, foreignFieldId).map((colRef) => kysely.sql`${kysely.sql.raw(aggregate)}(${colRef})`.as(outputAlias))).exhaustive();
	}
	getForeignColRef(foreignTable, foreignFieldId) {
		return foreignTable.getField((f) => f.id().equals(foreignFieldId)).andThen((field) => field.dbFieldName().andThen((dbFieldName) => dbFieldName.value()).map((columnName) => kysely.sql`${kysely.sql.ref(`${F}.${columnName}`)}`));
	}
	/**
	* Build join condition based on relationship type.
	*
	* FK config meanings from LinkFieldConfig.buildDbConfig:
	* - manyOne/oneOne: selfKeyName='__id', foreignKeyName='__fk_{fieldId}' (FK in current table)
	*   → join: f.__id = t.{foreignKeyName}
	* - oneMany: selfKeyName='__fk_{symmetricFieldId}', foreignKeyName='__id' (FK in foreign table)
	*   → join: f.{selfKeyName} = t.__id
	* - manyMany: both keys point to junction table columns
	*   → join via junction table
	*/
	getJoinCondition(linkField, _foreignTableName) {
		const relationship = linkField.relationship();
		const selfKeyNameResult = linkField.selfKeyName().value();
		const foreignKeyNameResult = linkField.foreignKeyName().value();
		if (relationship.equals(_teable_v2_core.LinkRelationship.manyOne()) || relationship.equals(_teable_v2_core.LinkRelationship.oneOne())) {
			if (foreignKeyNameResult.isOk() && foreignKeyNameResult.value !== "__id") return (0, neverthrow.ok)(kysely.sql`${kysely.sql.ref(`${F}.__id`)} = ${kysely.sql.ref(`${T$1}.${foreignKeyNameResult.value}`)}`);
			if (selfKeyNameResult.isOk() && selfKeyNameResult.value !== "__id") return (0, neverthrow.ok)(kysely.sql`${kysely.sql.ref(`${F}.${selfKeyNameResult.value}`)} = ${kysely.sql.ref(`${T$1}.__id`)}`);
		}
		if (relationship.equals(_teable_v2_core.LinkRelationship.oneMany())) {
			if (selfKeyNameResult.isOk() && selfKeyNameResult.value !== "__id") return (0, neverthrow.ok)(kysely.sql`${kysely.sql.ref(`${F}.${selfKeyNameResult.value}`)} = ${kysely.sql.ref(`${T$1}.__id`)}`);
			if (foreignKeyNameResult.isOk() && foreignKeyNameResult.value !== "__id") return (0, neverthrow.ok)(kysely.sql`${kysely.sql.ref(`${F}.__id`)} = ${kysely.sql.ref(`${T$1}.${foreignKeyNameResult.value}`)}`);
		}
		if (relationship.equals(_teable_v2_core.LinkRelationship.manyMany())) {
			const fkHostTableNameResult = linkField.fkHostTableName().value();
			if (fkHostTableNameResult.isOk() && selfKeyNameResult.isOk() && foreignKeyNameResult.isOk()) {
				const junctionTable = fkHostTableNameResult.value;
				const selfKey = selfKeyNameResult.value;
				const foreignKey = foreignKeyNameResult.value;
				return (0, neverthrow.ok)(kysely.sql`${kysely.sql.ref(`${F}.__id`)} IN (SELECT ${kysely.sql.ref(`j.${foreignKey}`)} FROM ${kysely.sql.table(junctionTable)} AS j WHERE ${kysely.sql.ref(`j.${selfKey}`)} = ${kysely.sql.ref(`${T$1}.__id`)})`);
			}
		}
		return (0, neverthrow.err)(_teable_v2_core.domainError.validation({ message: `Cannot build join condition for link field: missing FK configuration` }));
	}
};

//#endregion
//#region src/query-builder/stored/StoredFieldSelectVisitor.ts
/**
* Visitor that generates simple SELECT expressions for stored column values.
* All fields are selected directly from the table without any computation.
*/
var StoredFieldSelectVisitor = class {
	constructor(tableAlias) {
		this.tableAlias = tableAlias;
	}
	selectColumn(field) {
		return field.dbFieldName().andThen((dbFieldName) => dbFieldName.value()).map((colName) => kysely.sql`${kysely.sql.ref(`${this.tableAlias}.${colName}`)}`.as(colName));
	}
	visitSingleLineTextField(field) {
		return this.selectColumn(field);
	}
	visitLongTextField(field) {
		return this.selectColumn(field);
	}
	visitNumberField(field) {
		return this.selectColumn(field);
	}
	visitCheckboxField(field) {
		return this.selectColumn(field);
	}
	visitDateField(field) {
		return this.selectColumn(field);
	}
	visitSingleSelectField(field) {
		return this.selectColumn(field);
	}
	visitMultipleSelectField(field) {
		return this.selectColumn(field);
	}
	visitUserField(field) {
		return this.selectColumn(field);
	}
	visitAttachmentField(field) {
		return this.selectColumn(field);
	}
	visitCreatedTimeField(field) {
		return this.selectColumn(field);
	}
	visitLastModifiedTimeField(field) {
		return this.selectColumn(field);
	}
	visitAutoNumberField(field) {
		return this.selectColumn(field);
	}
	visitCreatedByField(field) {
		return this.selectColumn(field);
	}
	visitLastModifiedByField(field) {
		return this.selectColumn(field);
	}
	visitRatingField(field) {
		return this.selectColumn(field);
	}
	visitButtonField(field) {
		return this.selectColumn(field);
	}
	visitFormulaField(field) {
		return this.selectColumn(field);
	}
	visitLinkField(field) {
		return this.selectColumn(field);
	}
	visitLookupField(field) {
		return this.selectColumn(field);
	}
	visitRollupField(field) {
		return this.selectColumn(field);
	}
};

//#endregion
//#region src/query-builder/stored/StoredTableRecordQueryBuilder.ts
const T = "t";
/**
* Query builder that selects all stored column values directly.
* No LATERAL joins, no formula computation - just raw column selection.
* Used for fast reads when pre-computed values are acceptable.
*/
var StoredTableRecordQueryBuilder = class {
	table = null;
	projection = null;
	limitValue = null;
	offsetValue = null;
	constructor(db) {
		this.db = db;
	}
	from(table) {
		this.table = table;
		return this;
	}
	select(projection) {
		this.projection = projection;
		return this;
	}
	limit(n) {
		this.limitValue = n;
		return this;
	}
	offset(n) {
		this.offsetValue = n;
		return this;
	}
	/**
	* No preparation needed for stored builder - reads pre-stored values.
	*/
	async prepare(_deps) {
		return (0, neverthrow.ok)(void 0);
	}
	build() {
		if (!this.table) return (0, neverthrow.err)(_teable_v2_core.domainError.validation({ message: "Call from() first" }));
		const table = this.table;
		const projection = this.projection;
		return (0, neverthrow.safeTry)(function* () {
			const tableName = yield* (yield* table.dbTableName()).value();
			const selectColumns = yield* this.buildSelectColumns(table, projection);
			const idColumn = kysely.sql`${kysely.sql.ref(`${T}.__id`)}`.as("__id");
			return (0, neverthrow.ok)(this.db.selectFrom(`${tableName} as ${T}`).select(() => [idColumn, ...selectColumns]).$if(this.limitValue !== null, (qb) => qb.limit(this.limitValue)).$if(this.offsetValue !== null, (qb) => qb.offset(this.offsetValue)));
		}.bind(this));
	}
	buildSelectColumns(table, projection) {
		return (0, neverthrow.safeTry)(function* () {
			const visitor = new StoredFieldSelectVisitor(T);
			const columns = [];
			for (const field of table.getFields()) {
				if (projection && !projection.some((p) => p.toString() === field.id().toString())) continue;
				columns.push(yield* field.accept(visitor));
			}
			return (0, neverthrow.ok)(columns);
		});
	}
};

//#endregion
//#region \0@oxc-project+runtime@0.103.0/helpers/decorateMetadata.js
function __decorateMetadata(k, v) {
	if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}

//#endregion
//#region \0@oxc-project+runtime@0.103.0/helpers/decorateParam.js
function __decorateParam(paramIndex, decorator) {
	return function(target, key) {
		decorator(target, key, paramIndex);
	};
}

//#endregion
//#region \0@oxc-project+runtime@0.103.0/helpers/decorate.js
function __decorate(decorators, target, key, desc) {
	var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
	if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
	else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
	return c > 3 && r && Object.defineProperty(target, key, r), r;
}

//#endregion
//#region src/query-builder/TableRecordQueryBuilderManager.ts
let TableRecordQueryBuilderManager = class TableRecordQueryBuilderManager$1 {
	constructor(db, tableRepository) {
		this.db = db;
		this.tableRepository = tableRepository;
	}
	/**
	* Create a query builder for the given table.
	* Calls prepare() on the builder to let it load any required data.
	*
	* @param context - Execution context for repository calls
	* @param table - The main table to query
	* @param options - Optional mode configuration
	* @returns Result containing the prepared query builder
	*/
	async createBuilder(context, table, options) {
		const db = this.db;
		const builder = (options?.mode ?? "computed") === "stored" ? new StoredTableRecordQueryBuilder(db).from(table) : new ComputedTableRecordQueryBuilder(db).from(table);
		return (0, neverthrow.safeTry)(async function* () {
			yield* await builder.prepare({
				context,
				tableRepository: this.tableRepository
			});
			return (0, neverthrow.ok)(builder);
		}.bind(this));
	}
};
TableRecordQueryBuilderManager = __decorate([
	(0, _teable_v2_di.injectable)(),
	__decorateParam(0, (0, _teable_v2_di.inject)(v2RecordRepositoryPostgresTokens.db)),
	__decorateParam(1, (0, _teable_v2_di.inject)(_teable_v2_core.v2CoreTokens.tableRepository)),
	__decorateMetadata("design:paramtypes", [Object, Object])
], TableRecordQueryBuilderManager);

//#endregion
//#region src/repository/PostgresTableRecordQueryRepository.ts
var _ref;
const RECORD_ID_COLUMN$1 = "__id";
let PostgresTableRecordQueryRepository = class PostgresTableRecordQueryRepository$1 {
	constructor(queryBuilderManager, logger) {
		this.queryBuilderManager = queryBuilderManager;
		this.logger = logger;
	}
	async find(context, table, _spec, options) {
		return (0, neverthrow.safeTry)(async function* () {
			const builtQuery = yield* (yield* await this.queryBuilderManager.createBuilder(context, table, { mode: options?.mode })).build();
			const compiled = builtQuery.compile();
			this.logger.debug(`find:sql\n${compiled.sql}`, { parameters: compiled.parameters });
			const fieldColumns = yield* new FieldOutputColumnVisitor().collect(table);
			try {
				return (0, neverthrow.ok)(mapRowsToReadModels(fieldColumns, await builtQuery.execute()));
			} catch (error) {
				return (0, neverthrow.err)(_teable_v2_core.domainError.unexpected({ message: `Failed to load table records: ${describeError$1(error)}` }));
			}
		}.bind(this));
	}
};
PostgresTableRecordQueryRepository = __decorate([
	(0, _teable_v2_di.injectable)(),
	__decorateParam(0, (0, _teable_v2_di.inject)(v2RecordRepositoryPostgresTokens.tableRecordQueryBuilderManager)),
	__decorateParam(1, (0, _teable_v2_di.inject)(_teable_v2_core.v2CoreTokens.logger)),
	__decorateMetadata("design:paramtypes", [typeof (_ref = typeof TableRecordQueryBuilderManager !== "undefined" && TableRecordQueryBuilderManager) === "function" ? _ref : Object, Object])
], PostgresTableRecordQueryRepository);
const mapRowsToReadModels = (fieldColumns, rows) => {
	return rows.map((row) => {
		const rawId = row[RECORD_ID_COLUMN$1];
		const id = typeof rawId === "string" ? rawId : String(rawId);
		const fields = {};
		for (const column of fieldColumns) fields[column.fieldId.toString()] = row[column.columnAlias];
		return {
			id,
			fields
		};
	});
};
const describeError$1 = (error) => {
	if ((0, _teable_v2_core.isDomainError)(error)) return error.message;
	if (error instanceof Error) return error.message ? `${error.name}: ${error.message}` : error.name;
	if (typeof error === "string") return error;
	try {
		return JSON.stringify(error) ?? String(error);
	} catch {
		return String(error);
	}
};

//#endregion
//#region src/visitors/FieldDatabaseValueVisitor.ts
/**
* Visitor that transforms cell values to their database storage format.
*
* This handles the conversion of JavaScript values to PostgreSQL-compatible formats:
* - Primitive values (string, number, boolean) are returned as-is
* - Complex values (arrays, objects) are JSON stringified for JSONB columns
*
* Usage:
* ```typescript
* const visitor = FieldDatabaseValueVisitor.create(cellValue.toValue());
* const dbValue = field.accept(visitor);
* ```
*/
var FieldDatabaseValueVisitor = class FieldDatabaseValueVisitor {
	constructor(rawValue) {
		this.rawValue = rawValue;
	}
	static create(rawValue) {
		return new FieldDatabaseValueVisitor(rawValue);
	}
	visitSingleLineTextField(_field) {
		return (0, _teable_v2_core.ok)(this.rawValue);
	}
	visitLongTextField(_field) {
		return (0, _teable_v2_core.ok)(this.rawValue);
	}
	visitNumberField(_field) {
		return (0, _teable_v2_core.ok)(this.rawValue);
	}
	visitRatingField(_field) {
		return (0, _teable_v2_core.ok)(this.rawValue);
	}
	visitFormulaField(_field) {
		return (0, _teable_v2_core.ok)(null);
	}
	visitRollupField(_field) {
		return (0, _teable_v2_core.ok)(null);
	}
	visitLookupField(_field) {
		return (0, _teable_v2_core.ok)(null);
	}
	visitSingleSelectField(_field) {
		return (0, _teable_v2_core.ok)(this.rawValue);
	}
	visitMultipleSelectField(_field) {
		if (this.rawValue === null || this.rawValue === void 0) return (0, _teable_v2_core.ok)(null);
		return (0, _teable_v2_core.ok)(JSON.stringify(this.rawValue));
	}
	visitCheckboxField(_field) {
		return (0, _teable_v2_core.ok)(this.rawValue);
	}
	visitDateField(_field) {
		return (0, _teable_v2_core.ok)(this.rawValue);
	}
	visitAttachmentField(_field) {
		if (this.rawValue === null || this.rawValue === void 0) return (0, _teable_v2_core.ok)(null);
		return (0, _teable_v2_core.ok)(JSON.stringify(this.rawValue));
	}
	visitUserField(_field) {
		if (this.rawValue === null || this.rawValue === void 0) return (0, _teable_v2_core.ok)(null);
		return (0, _teable_v2_core.ok)(JSON.stringify(this.rawValue));
	}
	visitLinkField(_field) {
		if (this.rawValue === null || this.rawValue === void 0) return (0, _teable_v2_core.ok)(null);
		return (0, _teable_v2_core.ok)(JSON.stringify(this.rawValue));
	}
	visitCreatedTimeField(_field) {
		return (0, _teable_v2_core.ok)(null);
	}
	visitLastModifiedTimeField(_field) {
		return (0, _teable_v2_core.ok)(null);
	}
	visitCreatedByField(_field) {
		return (0, _teable_v2_core.ok)(null);
	}
	visitLastModifiedByField(_field) {
		return (0, _teable_v2_core.ok)(null);
	}
	visitAutoNumberField(_field) {
		return (0, _teable_v2_core.ok)(null);
	}
	visitButtonField(_field) {
		return (0, _teable_v2_core.ok)(null);
	}
};

//#endregion
//#region src/visitors/PostgresCellValueSpecVisitor.ts
/**
* PostgreSQL implementation of ICellValueSpecVisitor.
*
* This visitor collects column/value pairs from SetValueSpecs for use in
* UPDATE SQL generation.
*
* Future: Will be used when implementing repository.update() to generate
* UPDATE SET column1 = value1, column2 = value2 ... queries.
*
* Usage:
* ```typescript
* const visitor = new PostgresCellValueSpecVisitor();
* await spec.accept(visitor);
* const entries = visitor.getColumnValues();
* // Use entries to generate UPDATE SQL
* ```
*/
var PostgresCellValueSpecVisitor = class {
	entries = [];
	/**
	* Generic visit method for ISpecification interface.
	* Required by ISpecVisitor.
	*/
	visit(_spec) {
		return (0, _teable_v2_core.ok)(void 0);
	}
	visitSetSingleLineTextValue(spec) {
		this.entries.push({
			fieldId: spec.fieldId.toString(),
			value: spec.value.toValue()
		});
		return (0, _teable_v2_core.ok)(void 0);
	}
	visitSetLongTextValue(spec) {
		this.entries.push({
			fieldId: spec.fieldId.toString(),
			value: spec.value.toValue()
		});
		return (0, _teable_v2_core.ok)(void 0);
	}
	visitSetNumberValue(spec) {
		this.entries.push({
			fieldId: spec.fieldId.toString(),
			value: spec.value.toValue()
		});
		return (0, _teable_v2_core.ok)(void 0);
	}
	visitSetRatingValue(spec) {
		this.entries.push({
			fieldId: spec.fieldId.toString(),
			value: spec.value.toValue()
		});
		return (0, _teable_v2_core.ok)(void 0);
	}
	visitSetSingleSelectValue(spec) {
		this.entries.push({
			fieldId: spec.fieldId.toString(),
			value: spec.value.toValue()
		});
		return (0, _teable_v2_core.ok)(void 0);
	}
	visitSetMultipleSelectValue(spec) {
		this.entries.push({
			fieldId: spec.fieldId.toString(),
			value: spec.value.toValue()
		});
		return (0, _teable_v2_core.ok)(void 0);
	}
	visitSetCheckboxValue(spec) {
		this.entries.push({
			fieldId: spec.fieldId.toString(),
			value: spec.value.toValue()
		});
		return (0, _teable_v2_core.ok)(void 0);
	}
	visitSetDateValue(spec) {
		this.entries.push({
			fieldId: spec.fieldId.toString(),
			value: spec.value.toValue()
		});
		return (0, _teable_v2_core.ok)(void 0);
	}
	visitSetAttachmentValue(spec) {
		this.entries.push({
			fieldId: spec.fieldId.toString(),
			value: JSON.stringify(spec.value.toValue())
		});
		return (0, _teable_v2_core.ok)(void 0);
	}
	visitSetLinkValue(spec) {
		this.entries.push({
			fieldId: spec.fieldId.toString(),
			value: JSON.stringify(spec.value.toValue())
		});
		return (0, _teable_v2_core.ok)(void 0);
	}
	visitSetUserValue(spec) {
		this.entries.push({
			fieldId: spec.fieldId.toString(),
			value: JSON.stringify(spec.value.toValue())
		});
		return (0, _teable_v2_core.ok)(void 0);
	}
	/**
	* Get all collected column/value entries.
	*/
	getColumnValues() {
		return [...this.entries];
	}
	/**
	* Clear all collected entries.
	*/
	clear() {
		this.entries.length = 0;
	}
};

//#endregion
//#region src/repository/PostgresTableRecordRepository.ts
const RECORD_ID_COLUMN = "__id";
const CREATED_TIME_COLUMN = "__created_time";
const CREATED_BY_COLUMN = "__created_by";
const LAST_MODIFIED_TIME_COLUMN = "__last_modified_time";
const LAST_MODIFIED_BY_COLUMN = "__last_modified_by";
const VERSION_COLUMN = "__version";
let PostgresTableRecordRepository = class PostgresTableRecordRepository$1 {
	constructor(db, logger) {
		this.db = db;
		this.logger = logger;
	}
	async insert(context, table, record) {
		const repo = this;
		return (0, neverthrow.safeTry)(async function* () {
			const tableName = yield* (yield* table.dbTableName()).value();
			const now = (/* @__PURE__ */ new Date()).toISOString();
			const actorId = context.actorId.toString();
			const values = {
				[RECORD_ID_COLUMN]: record.id().toString(),
				[CREATED_TIME_COLUMN]: now,
				[CREATED_BY_COLUMN]: actorId,
				[LAST_MODIFIED_TIME_COLUMN]: now,
				[LAST_MODIFIED_BY_COLUMN]: actorId,
				[VERSION_COLUMN]: 1
			};
			const fields = table.getFields();
			const recordFields = record.fields();
			for (const field of fields) {
				if (field.computed().toBoolean()) continue;
				const dbFieldNameResult = field.dbFieldName();
				if (dbFieldNameResult.isErr()) continue;
				const dbFieldNameValueResult = dbFieldNameResult.value.value();
				if (dbFieldNameValueResult.isErr()) continue;
				const dbFieldName = dbFieldNameValueResult.value;
				const rawValue = recordFields.get(field.id())?.toValue() ?? null;
				const dbValueVisitor = FieldDatabaseValueVisitor.create(rawValue);
				const dbValueResult = field.accept(dbValueVisitor);
				values[dbFieldName] = dbValueResult.isOk() ? dbValueResult.value : rawValue;
			}
			repo.logger.debug(`insert:table=${tableName}`, { values });
			try {
				await repo.db.insertInto(tableName).values(values).execute();
			} catch (error) {
				return (0, neverthrow.err)(_teable_v2_core.domainError.infrastructure({
					message: `Failed to insert record: ${describeError(error)}`,
					code: "infrastructure.database.insert_failed",
					details: {
						tableName,
						error: describeError(error)
					}
				}));
			}
			return (0, neverthrow.ok)(void 0);
		});
	}
	async update(_context, _table, _record) {
		return (0, neverthrow.err)(_teable_v2_core.domainError.unexpected({ message: "Update not implemented yet" }));
	}
	async delete(_context, table, recordId) {
		const repo = this;
		return (0, neverthrow.safeTry)(async function* () {
			const tableName = yield* (yield* table.dbTableName()).value();
			try {
				await repo.db.deleteFrom(tableName).where(RECORD_ID_COLUMN, "=", recordId.toString()).execute();
			} catch (error) {
				return (0, neverthrow.err)(_teable_v2_core.domainError.infrastructure({
					message: `Failed to delete record: ${describeError(error)}`,
					code: "infrastructure.database.delete_failed",
					details: {
						tableName,
						recordId: recordId.toString(),
						error: describeError(error)
					}
				}));
			}
			return (0, neverthrow.ok)(void 0);
		});
	}
};
PostgresTableRecordRepository = __decorate([
	(0, _teable_v2_di.injectable)(),
	__decorateParam(0, (0, _teable_v2_di.inject)(v2RecordRepositoryPostgresTokens.db)),
	__decorateParam(1, (0, _teable_v2_di.inject)(_teable_v2_core.v2CoreTokens.logger)),
	__decorateMetadata("design:paramtypes", [Object, Object])
], PostgresTableRecordRepository);
const describeError = (error) => {
	if ((0, _teable_v2_core.isDomainError)(error)) return error.message;
	if (error instanceof Error) return error.message ? `${error.name}: ${error.message}` : error.name;
	if (typeof error === "string") return error;
	try {
		return JSON.stringify(error) ?? String(error);
	} catch {
		return String(error);
	}
};

//#endregion
//#region src/di/register.ts
const registerV2RecordRepositoryPostgresAdapter = (c = _teable_v2_di.container, config) => {
	c.registerInstance(v2RecordRepositoryPostgresTokens.db, config.db);
	c.register(v2RecordRepositoryPostgresTokens.tableRecordQueryBuilderManager, TableRecordQueryBuilderManager, { lifecycle: _teable_v2_di.Lifecycle.Singleton });
	c.register(_teable_v2_core.v2CoreTokens.tableRecordQueryRepository, PostgresTableRecordQueryRepository, { lifecycle: _teable_v2_di.Lifecycle.Singleton });
	c.register(_teable_v2_core.v2CoreTokens.tableRecordRepository, PostgresTableRecordRepository, { lifecycle: _teable_v2_di.Lifecycle.Singleton });
	return c;
};

//#endregion
exports.ComputedFieldSelectExpressionVisitor = ComputedFieldSelectExpressionVisitor;
exports.ComputedTableRecordQueryBuilder = ComputedTableRecordQueryBuilder;
exports.FieldDatabaseValueVisitor = FieldDatabaseValueVisitor;
exports.FieldOutputColumnVisitor = FieldOutputColumnVisitor;
exports.PostgresCellValueSpecVisitor = PostgresCellValueSpecVisitor;
Object.defineProperty(exports, 'PostgresTableRecordQueryRepository', {
  enumerable: true,
  get: function () {
    return PostgresTableRecordQueryRepository;
  }
});
Object.defineProperty(exports, 'PostgresTableRecordRepository', {
  enumerable: true,
  get: function () {
    return PostgresTableRecordRepository;
  }
});
exports.SqlAggregate = SqlAggregate;
exports.StoredFieldSelectVisitor = StoredFieldSelectVisitor;
exports.StoredTableRecordQueryBuilder = StoredTableRecordQueryBuilder;
Object.defineProperty(exports, 'TableRecordQueryBuilderManager', {
  enumerable: true,
  get: function () {
    return TableRecordQueryBuilderManager;
  }
});
exports.registerV2RecordRepositoryPostgresAdapter = registerV2RecordRepositoryPostgresAdapter;
exports.v2RecordRepositoryPostgresTokens = v2RecordRepositoryPostgresTokens;