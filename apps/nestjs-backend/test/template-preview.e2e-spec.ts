/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import { FieldType, ViewType, NumberFormattingType, HttpError } from '@teable/core';
import {
  IS_TEMPLATE_HEADER,
  axios as defaultAxios,
  createAxios,
  createBase,
  createField,
  createRecords,
  createSpace,
  createTemplate,
  createTemplateSnapshot,
  deleteBase,
  getBaseById,
  getTemplateDetail,
  updateTemplate,
  deleteTemplate,
  permanentDeleteSpace,
} from '@teable/openapi';
import type { IGetBaseVo, ITableFullVo, ITableListVo } from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { TemplateAppTokenNotAllowedException } from '../src/custom.exception';
import { AuthService } from '../src/features/auth/auth.service';
import { PermissionService } from '../src/features/auth/permission.service';
import { JwtAuthInternalType } from '../src/features/auth/strategies/types';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { createTable, createView, initApp, permanentDeleteBase } from './utils/init-app';

describe('Template Preview Permission (e2e)', () => {
  let app: INestApplication;
  let permissionService: PermissionService;
  let spaceId: string;
  let baseId: string;
  let templateBaseId: string;
  let templateId: string;
  let templateHeader: string;
  let table: ITableFullVo;
  let tableId: string;

  // Factory function to create apiRequest with specific axios instance
  const createApiRequest = (axiosInstance: AxiosInstance) => {
    return async <T = any>(
      method: string,
      url: string,
      data?: any
    ): Promise<{ status: number; data: T }> => {
      try {
        const res = await axiosInstance.request<T>({
          method,
          url,
          data,
          headers: {
            [IS_TEMPLATE_HEADER]: templateHeader,
          },
        });
        return { status: res.status, data: res.data };
      } catch (err: any) {
        if (err instanceof HttpError) {
          return { status: err.status, data: err.data as T };
        }
        return { status: err.response?.status || 500, data: err.response?.data as T };
      }
    };
  };

  beforeAll(async () => {
    const appContext = await initApp();
    app = appContext.app;
    permissionService = app.get(PermissionService);

    const spaceData = await createSpace({
      name: 'test Template Space',
    });
    spaceId = spaceData.data.id;
  });

  afterAll(async () => {
    await permanentDeleteSpace(spaceId);
  });

  beforeEach(async () => {
    // Create a normal base
    const { id } = (
      await createBase({
        name: 'test base',
        spaceId,
      })
    ).data;
    baseId = id;

    // Create a table in the base
    table = await createTable(baseId, {
      name: 'Table 1',
      fields: [
        {
          name: 'Name',
          type: FieldType.SingleLineText,
        },
      ],
    });

    tableId = table.id;

    // Add more fields
    await createField(tableId, {
      name: 'NumberField',
      type: FieldType.Number,
      options: {
        formatting: {
          type: NumberFormattingType.Decimal,
          precision: 2,
        },
      },
    });

    // Create some records
    await createRecords(tableId, {
      records: [
        { fields: { Name: 'Record 1', NumberField: 100 } },
        { fields: { Name: 'Record 2', NumberField: 200 } },
      ],
    });

    // Create a template from this base
    const template = await createTemplate({});
    templateId = template.data.id;

    await updateTemplate(templateId, {
      name: 'Test Template',
      description: 'Test Template Description',
      baseId: baseId,
    });

    await createTemplateSnapshot(templateId);
    await updateTemplate(templateId, {
      isPublished: true,
    });

    const templateDetail = await getTemplateDetail(templateId);
    templateBaseId = templateDetail.data.snapshot.baseId!;

    // Generate template header for authentication
    templateHeader = permissionService.generateTemplateHeader(templateId);
  });

  afterEach(async () => {
    await deleteTemplate(templateId);
    await permanentDeleteBase(baseId);
  });

  // Test suite factory that runs with different axios instances
  const runTemplatePermissionTests = (
    description: string,
    getAxios: () => AxiosInstance,
    isAnonymous?: boolean
  ) => {
    describe(description, () => {
      let apiRequest: ReturnType<typeof createApiRequest>;

      beforeAll(() => {
        const axiosInstance = getAxios();
        axiosInstance.defaults.baseURL = defaultAxios.defaults.baseURL;
        apiRequest = createApiRequest(axiosInstance);
      });

      describe('Base Read Operations', () => {
        it('should allow getBaseById with valid template header', async () => {
          const res = await apiRequest('GET', `/base/${templateBaseId}`);
          expect(res.status).toBe(200);
          expect(res.data.id).toBe(templateBaseId);
          expect(res.data.name).toBe('Test Template');
        });

        it('should allow reading base permission with template header', async () => {
          const res = await apiRequest('GET', `/base/${templateBaseId}/permission`);
          expect(res.status).toBe(200);
          // Template should only have read permissions
          expect(res.data['base|read']).toBe(true);
          expect(res.data['base|update']).toBe(false);
          expect(res.data['base|delete']).toBe(false);
          expect(res.data['table|create']).toBe(false);
        });
      });

      describe('Base Write Operations - Should be Denied', () => {
        it('should deny updateBase with template header', async () => {
          const res = await apiRequest('PATCH', `/base/${templateBaseId}`, {
            name: 'Updated Name',
          });
          expect([401, 403]).toContain(res.status);
        });

        it('should deny deleteBase with template header', async () => {
          const res = await apiRequest('DELETE', `/base/${templateBaseId}`);
          expect([401, 403]).toContain(res.status);
        });

        it('should deny creating invitation link with template header', async () => {
          const res = await apiRequest('POST', `/base/${templateBaseId}/invitation/link`, {
            role: 'viewer',
          });
          expect([401, 403]).toContain(res.status);
        });
      });

      describe('Table Read Operations', () => {
        it('should allow getTableList with template header', async () => {
          const res = await apiRequest('GET', `/base/${templateBaseId}/table`);
          expect(res.status).toBe(200);
          expect(res.data.length).toBeGreaterThan(0);
        });

        it('should allow getting single table with template header', async () => {
          const tablesRes = await apiRequest<any[]>('GET', `/base/${templateBaseId}/table`);
          const testTableId = tablesRes.data[0].id;

          const res = await apiRequest('GET', `/base/${templateBaseId}/table/${testTableId}`);
          expect(res.status).toBe(200);
          expect(res.data.id).toBe(testTableId);
        });

        it('should allow reading table permission with template header', async () => {
          const tablesRes = await apiRequest<any[]>('GET', `/base/${templateBaseId}/table`);
          const testTableId = tablesRes.data[0].id;

          const res = await apiRequest(
            'GET',
            `/base/${templateBaseId}/table/${testTableId}/permission`
          );
          expect(res.status).toBe(200);
          expect(res.data.table['table|read']).toBe(true);
          expect(res.data.table['table|create']).toBe(false);
          expect(res.data.table['table|update']).toBe(false);
          expect(res.data.table['table|delete']).toBe(false);
        });
      });

      describe('Table Write Operations - Should be Denied', () => {
        it('should deny createTable with template header', async () => {
          const res = await apiRequest('POST', `/base/${templateBaseId}/table`, {
            name: 'New Table',
          });
          expect(res.status).toBe(403);
        });

        it('should deny updateTable with template header', async () => {
          const tablesRes = await apiRequest<any[]>('GET', `/base/${templateBaseId}/table`);
          const testTableId = tablesRes.data[0].id;

          const res = await apiRequest('PUT', `/base/${templateBaseId}/table/${testTableId}/name`, {
            name: 'Updated Table Name',
          });
          expect(res.status).toBe(403);
        });

        it('should deny deleteTable with template header', async () => {
          const tablesRes = await apiRequest<any[]>('GET', `/base/${templateBaseId}/table`);
          const testTableId = tablesRes.data[0].id;

          const res = await apiRequest('DELETE', `/base/${templateBaseId}/table/${testTableId}`);
          expect(res.status).toBe(403);
        });
      });

      describe('Field Read Operations', () => {
        it('should allow getFields with template header', async () => {
          const tablesRes = await apiRequest<any[]>('GET', `/base/${templateBaseId}/table`);
          const testTableId = tablesRes.data[0].id;

          const res = await apiRequest('GET', `/table/${testTableId}/field`);
          expect(res.status).toBe(200);
          expect(res.data.length).toBeGreaterThan(0);
        });

        it('should allow getting single field with template header', async () => {
          const tablesRes = await apiRequest<any[]>('GET', `/base/${templateBaseId}/table`);
          const testTableId = tablesRes.data[0].id;

          const fieldsRes = await apiRequest<any[]>('GET', `/table/${testTableId}/field`);
          const fieldId = fieldsRes.data[0].id;

          const res = await apiRequest('GET', `/table/${testTableId}/field/${fieldId}`);
          expect(res.status).toBe(200);
        });
      });

      describe('Field Write Operations - Should be Denied', () => {
        it('should deny createField with template header', async () => {
          const tablesRes = await apiRequest<any[]>('GET', `/base/${templateBaseId}/table`);
          const testTableId = tablesRes.data[0].id;

          const res = await apiRequest('POST', `/table/${testTableId}/field`, {
            name: 'New Field',
            type: FieldType.SingleLineText,
          });
          expect(res.status).toBe(403);
        });

        it('should deny updateField with template header', async () => {
          const tablesRes = await apiRequest<any[]>('GET', `/base/${templateBaseId}/table`);
          const testTableId = tablesRes.data[0].id;

          const fieldsRes = await apiRequest<any[]>('GET', `/table/${testTableId}/field`);
          const fieldId = fieldsRes.data[0].id;

          const res = await apiRequest('PATCH', `/table/${testTableId}/field/${fieldId}`, {
            name: 'Updated Field Name',
          });
          expect(res.status).toBe(403);
        });

        it('should deny deleteField with template header', async () => {
          const tablesRes = await apiRequest<any[]>('GET', `/base/${templateBaseId}/table`);
          const testTableId = tablesRes.data[0].id;

          const fieldsRes = await apiRequest<any[]>('GET', `/table/${testTableId}/field`);
          const fieldId = fieldsRes.data[0].id;

          const res = await apiRequest('DELETE', `/table/${testTableId}/field/${fieldId}`);
          expect(res.status).toBe(403);
        });
      });

      describe('View Read Operations', () => {
        it('should allow getViews with template header', async () => {
          const tablesRes = await apiRequest<any[]>('GET', `/base/${templateBaseId}/table`);
          const testTableId = tablesRes.data[0].id;

          const res = await apiRequest('GET', `/table/${testTableId}/view`);
          expect(res.status).toBe(200);
          expect(res.data.length).toBeGreaterThan(0);
        });

        it('should allow getting single view with template header', async () => {
          const tablesRes = await apiRequest<any[]>('GET', `/base/${templateBaseId}/table`);
          const testTableId = tablesRes.data[0].id;

          const viewsRes = await apiRequest<any[]>('GET', `/table/${testTableId}/view`);
          const viewId = viewsRes.data[0].id;

          const res = await apiRequest('GET', `/table/${testTableId}/view/${viewId}`);
          expect(res.status).toBe(200);
        });
      });

      describe('View Write Operations - Should be Denied', () => {
        it('should deny createView with template header', async () => {
          const tablesRes = await apiRequest<any[]>('GET', `/base/${templateBaseId}/table`);
          const testTableId = tablesRes.data[0].id;

          const res = await apiRequest('POST', `/table/${testTableId}/view`, {
            name: 'New View',
            type: ViewType.Grid,
          });
          expect(res.status).toBe(403);
        });

        it('should deny updateView with template header', async () => {
          const tablesRes = await apiRequest<any[]>('GET', `/base/${templateBaseId}/table`);
          const testTableId = tablesRes.data[0].id;

          const viewsRes = await apiRequest<any[]>('GET', `/table/${testTableId}/view`);
          const viewId = viewsRes.data[0].id;

          const res = await apiRequest('PUT', `/table/${testTableId}/view/${viewId}/name`, {
            name: 'Updated View Name',
          });
          expect(res.status).toBe(403);
        });

        it('should deny deleteView with template header', async () => {
          // Create a new view first to avoid deleting the default view
          const newView = await createView(tableId, { name: 'Test View', type: ViewType.Grid });
          const viewId = newView.id;

          const tablesRes = await apiRequest<any[]>('GET', `/base/${templateBaseId}/table`);
          const testTableId = tablesRes.data[0].id;

          const res = await apiRequest('DELETE', `/table/${testTableId}/view/${viewId}`);
          expect(res.status).toBe(403);
        });
      });

      describe('Record Read Operations', () => {
        it('should allow getRecords with template header', async () => {
          const tablesRes = await apiRequest<any[]>('GET', `/base/${templateBaseId}/table`);
          const testTableId = tablesRes.data[0].id;

          const res = await apiRequest('GET', `/table/${testTableId}/record`);
          expect(res.status).toBe(200);
          expect(res.data.records.length).toBeGreaterThan(0);
        });

        it('should allow getting single record with template header', async () => {
          const tablesRes = await apiRequest<any[]>('GET', `/base/${templateBaseId}/table`);
          const testTableId = tablesRes.data[0].id;

          const recordsRes = await apiRequest<any>('GET', `/table/${testTableId}/record`);
          const recordId = recordsRes.data.records[0].id;

          const res = await apiRequest('GET', `/table/${testTableId}/record/${recordId}`);
          expect(res.status).toBe(200);
        });
      });

      describe('Record Write Operations - Should be Denied', () => {
        it('should deny createRecords with template header', async () => {
          const tablesRes = await apiRequest<any[]>('GET', `/base/${templateBaseId}/table`);
          const testTableId = tablesRes.data[0].id;

          const res = await apiRequest('POST', `/table/${testTableId}/record`, {
            records: [{ fields: { Name: 'New Record' } }],
          });
          expect(res.status).toBe(403);
        });

        it('should deny updateRecord with template header', async () => {
          const tablesRes = await apiRequest<any[]>('GET', `/base/${templateBaseId}/table`);
          const testTableId = tablesRes.data[0].id;

          const recordsRes = await apiRequest<any>('GET', `/table/${testTableId}/record`);
          const recordId = recordsRes.data.records[0].id;

          const res = await apiRequest('PATCH', `/table/${testTableId}/record/${recordId}`, {
            fields: { Name: 'Updated Name' },
          });
          expect(res.status).toBe(403);
        });

        it('should deny deleteRecord with template header', async () => {
          const tablesRes = await apiRequest<any[]>('GET', `/base/${templateBaseId}/table`);
          const testTableId = tablesRes.data[0].id;

          const recordsRes = await apiRequest<any>('GET', `/table/${testTableId}/record`);
          const recordId = recordsRes.data.records[0].id;

          const res = await apiRequest('DELETE', `/table/${testTableId}/record/${recordId}`);
          expect(res.status).toBe(403);
        });
      });

      describe('Permission Isolation - No Cross-Resource Permission Leakage', () => {
        it('should not allow accessing other bases with template header', async () => {
          const anotherBase = await createBase({
            name: 'Another Base',
            spaceId,
          });

          const res = await apiRequest('GET', `/base/${anotherBase.data.id}`);
          expect(res.status).toBe(isAnonymous ? 401 : 403);

          await deleteBase(anotherBase.data.id);
        });

        it('should not allow accessing tables from other bases', async () => {
          const anotherBase = await createBase({
            name: 'Another Base',
            spaceId,
          });
          await createTable(anotherBase.data.id, {
            name: 'Another Table',
          });

          const res = await apiRequest('GET', `/base/${anotherBase.data.id}/table`);
          expect(res.status).toBe(isAnonymous ? 401 : 403);

          await deleteBase(anotherBase.data.id);
        });
      });

      describe('Template Header Validation', () => {
        it('should reject expired or malformed template headers', async () => {
          const invalidHeaders = [
            'invalid-jwt',
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature',
            'xxxxx',
            'Bearer token',
          ];

          for (const invalidHeader of invalidHeaders) {
            try {
              const axiosInstance = getAxios();
              await axiosInstance.get(`/base/${templateBaseId}/table`, {
                headers: {
                  [IS_TEMPLATE_HEADER]: invalidHeader,
                },
              });
              throw new Error('Should have thrown 403');
            } catch (error: any) {
              expect(error.status).toBe(isAnonymous ? 401 : 403);
            }
          }
        });
      });
    });
  };

  // Run tests with anonymous user (no authentication)
  describe('Anonymous User Tests', () => {
    let anonymousAxios: AxiosInstance;

    beforeAll(() => {
      anonymousAxios = createAxios();
    });

    runTemplatePermissionTests('Anonymous user with template header', () => anonymousAxios, true);
  });

  // Run tests with authenticated new user (not a collaborator)
  describe('Authenticated Non-Collaborator Tests', () => {
    let newUserAxios: AxiosInstance;
    const newUserEmail = 'template-test-user@example.com';

    beforeAll(async () => {
      newUserAxios = await createNewUserAxios({
        email: newUserEmail,
        password: '12345678',
      });
    });

    runTemplatePermissionTests('Authenticated user with template header', () => newUserAxios);
  });

  describe('Normal Base Access (Without Template Header)', () => {
    it('should work without template header for authenticated requests', async () => {
      const res = await getBaseById(templateBaseId);
      expect(res.status).toBe(200);
      expect(res.data.id).toBe(templateBaseId);
      expect(res.data.template).toBeDefined();
    });

    it('should work without template header for anonymous requests', async () => {
      const anonymousAxios = createAxios();
      anonymousAxios.defaults.baseURL = defaultAxios.defaults.baseURL;
      const res = await anonymousAxios.get<IGetBaseVo>(`/base/${templateBaseId}`);
      expect(res.status).toBe(200);
      expect(res.data.id).toBe(templateBaseId);
      expect(res.data.template).toBeDefined();
    });
  });

  describe('Template preview app token operations', () => {
    let appToken: string;
    const anonymousAxios = createAxios();
    let authService: AuthService;

    beforeAll(async () => {
      authService = app.get(AuthService);
    });

    beforeEach(async () => {
      const { accessToken } = await authService.getTempInternalToken(
        templateBaseId,
        JwtAuthInternalType.App
      );
      appToken = accessToken;
      anonymousAxios.defaults.baseURL = defaultAxios.defaults.baseURL;
    });
    it('should allow getTableList with valid app token', async () => {
      const res = await anonymousAxios.get<ITableListVo>(`/base/${templateBaseId}/table`, {
        headers: {
          Authorization: `Bearer ${appToken}`,
        },
      });
      expect(res.status).toBe(200);
      expect(res.data.length).toBeGreaterThan(0);
    });

    it('should allow createTable with valid app token', async () => {
      const res = await anonymousAxios.post<ITableFullVo>(
        `/base/${templateBaseId}/table`,
        {
          name: 'New Table',
        },
        {
          headers: {
            Authorization: `Bearer ${appToken}`,
          },
        }
      );
      expect(res.status).toBe(200);
      expect(res.data).toMatchObject({
        message: new TemplateAppTokenNotAllowedException().message,
      });
    });
  });
});
