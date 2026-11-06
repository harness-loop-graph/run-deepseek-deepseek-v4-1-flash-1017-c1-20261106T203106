import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { AttachmentsService } from './attachments.service';
import { AuthenticatedRequest, Roles } from '../common/guards';
import { AuthenticatedUser } from '../common/authorization';
import { ApiError } from '../common/errors';

interface UploadedMemoryFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Controller()
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Roles('professional')
  @Post('encounters/:id/attachments')
  @UseInterceptors(
    AnyFilesInterceptor({
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  )
  async upload(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFiles() files: UploadedMemoryFile[] | undefined,
  ) {
    const user = request.user as AuthenticatedUser;
    if (files && files.length > 1) {
      throw new ApiError('VALIDATION_ERROR', 'Only one file per request is allowed');
    }
    const file = files && files.length > 0 ? files[0] : undefined;
    return this.attachments.upload(user, id, file);
  }

  @Roles('patient', 'professional')
  @Get('attachments/:id')
  async download(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ): Promise<void> {
    const user = request.user as AuthenticatedUser;
    const attachment = await this.attachments.download(user, id);
    response.setHeader('Content-Type', attachment.contentType);
    response.setHeader('Content-Length', String(attachment.stream.byteLength));
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${attachment.filename.replace(/["\\\r\n]/g, '_')}"`,
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.status(200).end(attachment.stream);
  }
}
