import { Module } from '@nestjs/common';
import { EncountersService } from './encounters.service';

@Module({
  providers: [EncountersService],
  exports: [EncountersService],
})
export class EncountersModule {}
