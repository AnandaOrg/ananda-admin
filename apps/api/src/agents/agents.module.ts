import { Module } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { AgentSetupService } from './setup.service';

@Module({ controllers: [AgentsController], providers: [AgentsService, AgentSetupService] })
export class AgentsModule {}
