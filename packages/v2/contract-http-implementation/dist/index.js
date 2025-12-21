let _orpc_server = require("@orpc/server");
let _teable_v2_container_node = require("@teable/v2-container-node");
let _teable_v2_contract_http = require("@teable/v2-contract-http");
let _teable_v2_core = require("@teable/v2-core");

//#region src/handlers/tables/createTable.ts
const executeCreateTableEndpoint = async (context, rawBody, commandBus) => {
	const commandResult = _teable_v2_core.CreateTableCommand.create(rawBody);
	if (commandResult.isErr()) return {
		status: 400,
		body: {
			ok: false,
			error: commandResult.error
		}
	};
	const result = await commandBus.execute(context, commandResult.value);
	if (result.isErr()) return {
		status: 500,
		body: {
			ok: false,
			error: result.error
		}
	};
	const mapped = (0, _teable_v2_contract_http.mapCreateTableResultToDto)(result.value);
	if (mapped.isErr()) return {
		status: 500,
		body: {
			ok: false,
			error: mapped.error
		}
	};
	return {
		status: 201,
		body: {
			ok: true,
			data: mapped.value
		}
	};
};

//#endregion
//#region src/handlers/tables/getTableById.ts
const isNotFoundError = (error) => error === "Not found" || error === "Table not found";
const executeGetTableByIdEndpoint = async (context, rawInput, queryBus) => {
	const queryResult = _teable_v2_core.GetTableByIdQuery.create(rawInput);
	if (queryResult.isErr()) return {
		status: 400,
		body: {
			ok: false,
			error: queryResult.error
		}
	};
	const result = await queryBus.execute(context, queryResult.value);
	if (result.isErr()) {
		if (isNotFoundError(result.error)) return {
			status: 404,
			body: {
				ok: false,
				error: result.error
			}
		};
		return {
			status: 500,
			body: {
				ok: false,
				error: result.error
			}
		};
	}
	const mapped = (0, _teable_v2_contract_http.mapGetTableByIdResultToDto)(result.value);
	if (mapped.isErr()) return {
		status: 500,
		body: {
			ok: false,
			error: mapped.error
		}
	};
	return {
		status: 200,
		body: {
			ok: true,
			data: mapped.value
		}
	};
};

//#endregion
//#region src/router.ts
const createV2OrpcRouter = (options = {}) => {
	let defaultContainerPromise;
	const createContainer = options.createContainer ?? (() => {
		if (!defaultContainerPromise) defaultContainerPromise = (0, _teable_v2_container_node.createV2NodePgContainer)();
		return defaultContainerPromise;
	});
	const createExecutionContext = options.createExecutionContext ?? (() => {
		const actorIdResult = _teable_v2_core.ActorId.create("system");
		if (actorIdResult.isErr()) throw new Error(actorIdResult.error);
		return { actorId: actorIdResult.value };
	});
	const os = (0, _orpc_server.implement)(_teable_v2_contract_http.v2Contract);
	const tablesCreate = os.tables.create.handler(async ({ input }) => {
		let container;
		try {
			container = await createContainer();
		} catch {
			throw new _orpc_server.ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to create container" });
		}
		let executionContext;
		try {
			executionContext = await createExecutionContext();
		} catch {
			throw new _orpc_server.ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to resolve execution context" });
		}
		const commandBus = container.resolve(_teable_v2_core.v2CoreTokens.commandBus);
		const result = await executeCreateTableEndpoint(executionContext, input, commandBus);
		if (result.status === 201) return result.body;
		if (result.status === 400) throw new _orpc_server.ORPCError("BAD_REQUEST", { message: result.body.error });
		throw new _orpc_server.ORPCError("INTERNAL_SERVER_ERROR", { message: result.body.error });
	});
	const tablesGetById = os.tables.getById.handler(async ({ input }) => {
		let container;
		try {
			container = await createContainer();
		} catch {
			throw new _orpc_server.ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to create container" });
		}
		let executionContext;
		try {
			executionContext = await createExecutionContext();
		} catch {
			throw new _orpc_server.ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to resolve execution context" });
		}
		const queryBus = container.resolve(_teable_v2_core.v2CoreTokens.queryBus);
		const result = await executeGetTableByIdEndpoint(executionContext, input, queryBus);
		if (result.status === 200) return result.body;
		if (result.status === 400) throw new _orpc_server.ORPCError("BAD_REQUEST", { message: result.body.error });
		if (result.status === 404) throw new _orpc_server.ORPCError("NOT_FOUND", { message: result.body.error });
		throw new _orpc_server.ORPCError("INTERNAL_SERVER_ERROR", { message: result.body.error });
	});
	return os.router({ tables: {
		create: tablesCreate,
		getById: tablesGetById
	} });
};

//#endregion
exports.createV2OrpcRouter = createV2OrpcRouter;
exports.executeCreateTableEndpoint = executeCreateTableEndpoint;
exports.executeGetTableByIdEndpoint = executeGetTableByIdEndpoint;