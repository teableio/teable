import fs from 'fs';
import zlib from 'zlib';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class ExportImportService {
  private logger = new Logger(ExportImportService.name);

  constructor(private readonly prismaService: PrismaService) {}
  async createZipStream(filePath: string): Promise<NodeJS.ReadableStream> {
    await this.prune();
    const gzip = zlib.createGzip();
    const source = fs.createReadStream(filePath);
    source.pipe(gzip);
    return gzip;
  }

  async downloadAndUnzip(url: string, filePath: string): Promise<void> {
    if (!url) {
      throw new BadRequestException('URL is required');
    }
    const response = await axios.get(url, {
      responseType: 'stream',
    });

    if (response.status !== 200) {
      throw new NotFoundException('File not found at provided URL');
    }
    await this.prismaService.$disconnect();

    await new Promise((resolve, reject) => {
      const gunzip = zlib.createGunzip();
      response.data
        .pipe(gunzip)
        .pipe(fs.createWriteStream(filePath))
        .on('finish', resolve)
        .on('error', reject);
    });
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
