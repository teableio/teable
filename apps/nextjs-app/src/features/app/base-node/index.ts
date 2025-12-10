export type { ISSRContext, SSRHandler, SSRResult } from './types';

export { redirect } from './helper';

export { TablePage, getTableServerSideProps } from './TablePage';
export { DashBoardPage, getDashboardServerSideProps } from './DashBoardPage';
export { WorkflowPage, getWorkflowServerSideProps } from './WorkflowPage';
export { getBaseServerSideProps } from './BasePage';
