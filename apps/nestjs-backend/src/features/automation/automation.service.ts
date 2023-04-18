import { Injectable, Logger } from '@nestjs/common';
import { WorkflowService } from './workflow.service';

@Injectable()
export class AutomationService {
  private logger = new Logger(AutomationService.name);

  constructor(private readonly workflowService: WorkflowService) {}
}
