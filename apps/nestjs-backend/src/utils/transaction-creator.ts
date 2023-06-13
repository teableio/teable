/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ITransactionCreatorResult {
  /**
   * creators is a function array, each include a single doc submit operation
   * the length of creators is used to calculate the opCount of transactionMeta
   */
  creators: ((transactionKey: string) => Promise<any>)[];
  // extra data returned by the creatorGenerator
  opMeta?: any;
  // something need to do after creators executed
  afterCreate?: (...params: any[]) => any;
}

export interface ITransactionCreator {
  createCreators(...params: any[]): ITransactionCreatorResult;
}
