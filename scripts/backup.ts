import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import dotenv from 'dotenv';

dotenv.config();

const execAsync = promisify(exec);

const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const RETENTION_DAYS = 7;

async function runBackup() {
  console.log('Starting automated database backup...');

  // Ensure backup directory exists
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('Error: DATABASE_URL environment variable is not set.');
    process.exit(1);
  }

  // Create backup filename with timestamp
  const date = new Date();
  const timestamp = date.toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(BACKUP_DIR, `backup-${timestamp}.sql`);

  try {
    // Run pg_dump
    console.log(`Dumping database to ${backupFile}...`);
    // Note: pg_dump must be installed and accessible in the environment
    await execAsync(`pg_dump "${dbUrl}" -f "${backupFile}"`);
    console.log('Database backup completed successfully.');

    // Cleanup old backups
    cleanupOldBackups();
  } catch (error: any) {
    console.error('Database backup failed:', error.message);
    process.exit(1);
  }
}

function cleanupOldBackups() {
  console.log(`Cleaning up backups older than ${RETENTION_DAYS} days...`);
  
  const files = fs.readdirSync(BACKUP_DIR);
  const now = Date.now();
  const retentionMs = RETENTION_DAYS * 24 * 60 * 60 * 1000;
  
  let deletedCount = 0;

  for (const file of files) {
    if (!file.endsWith('.sql')) continue;

    const filePath = path.join(BACKUP_DIR, file);
    const stats = fs.statSync(filePath);
    
    // Check if file is older than retention period
    if (now - stats.mtimeMs > retentionMs) {
      fs.unlinkSync(filePath);
      console.log(`Deleted old backup: ${file}`);
      deletedCount++;
    }
  }

  console.log(`Cleanup complete. Deleted ${deletedCount} old backups.`);
}

runBackup();
