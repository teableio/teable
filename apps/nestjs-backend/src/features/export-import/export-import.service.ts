import * as fs from 'fs';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as archiver from 'archiver';
import axios from 'axios';
import fsExtra from 'fs-extra';
import * as unzipper from 'unzipper';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class ExportImportService {
  private logger = new Logger(ExportImportService.name);

  constructor(private readonly prismaService: PrismaService) {}

  private getFilePermissions(filePath: string) {
    const stats = fsExtra.statSync(filePath);
    // Extracting the permissions from the mode using a more accurate mask
    return (stats.mode & 0o777).toString(8);
  }

  async createZipStream(filePath: string): Promise<NodeJS.ReadableStream> {
    await this.prune();
    const archive = archiver.create('zip');
    archive.append(fs.createReadStream(filePath), { name: 'main.db' });
    archive.finalize();
    return archive;
  }

  async downloadAndUnzip(url: string, outputDir: string): Promise<void> {
    const response = await axios.get(url, {
      responseType: 'stream',
    });

    if (response.status !== 200) {
      throw new NotFoundException('File not found at provided URL');
    }

    await new Promise((resolve, reject) => {
      response.data
        .pipe(unzipper.Extract({ path: outputDir }))
        .on('close', resolve)
        .on('error', reject);
    });
    const permissionBefore = this.getFilePermissions(outputDir);
    this.logger.log('permissionBefore:' + permissionBefore);
    fsExtra.chmodSync(outputDir, '755');
    const permissionAfter = this.getFilePermissions(outputDir);
    this.logger.log('permissionAfter:' + permissionAfter);
  }

  async logDatabaseSize() {
    const countRaw = await this.prismaService.$queryRaw<
      {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        page_count: bigint;
      }[]
    >`PRAGMA page_count;`;

    const sizeRaw = await this.prismaService.$queryRaw<
      {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        page_size: bigint;
      }[]
    >`PRAGMA page_size;`;

    const sizeInBytes = Number(countRaw[0].page_count) * Number(sizeRaw[0].page_size);

    this.logger.log(`Database size: ${sizeInBytes} bytes`);
    this.logger.log(`Database size: ${(sizeInBytes / (1024 * 1024)).toFixed(2)} MB`);
    return sizeInBytes;
  }

  async prune() {
    await this.prismaService.$transaction(
      async (prisma) => {
        const tables = await prisma.tableMeta.findMany({
          where: { deletedTime: { not: null } },
        });
        const tableNames = tables.map((table) => table.name).join(', ');
        this.logger.log('prune tables: ', tableNames);
        const tableIds = tables.map((table) => table.id);
        // delete field for table
        await prisma.field.deleteMany({
          where: { tableId: { in: tableIds } },
        });

        // delete view for table
        await prisma.view.deleteMany({
          where: { tableId: { in: tableIds } },
        });

        await prisma.tableMeta.deleteMany({
          where: { id: { in: tableIds } },
        });

        await prisma.ops.deleteMany({
          where: { collection: { in: tableIds } },
        });

        await prisma.ops.deleteMany({
          where: { docId: { in: tableIds } },
        });
        return tableNames;
      },
      { timeout: 100000, maxWait: 100000 }
    );

    this.logger.log('prune succeed!');
    await this.prismaService.$executeRawUnsafe('VACUUM');
    this.logger.log('vacuum db space succeed!');
    return await this.logDatabaseSize();
  }
}
