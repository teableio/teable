import backendSetup from '../../vitest-e2e.setup';
import { registerSharedTestHost } from '../../../../packages/v2/e2e/src/shared/globalTestContext';
import { createNestTestContext } from './v2-native-parity-context';

// The production default retains the real computed outbox; only `sync` is a
// supported explicit override. The standalone corpus has no app .env file.
await backendSetup;
delete process.env.V2_COMPUTED_UPDATE_MODE;
process.env.PUBLIC_ORIGIN ??= 'http://127.0.0.1:3000';
registerSharedTestHost(createNestTestContext);
