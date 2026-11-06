import dotenv from 'dotenv';
import path from 'path';

// Carrega variáveis do arquivo .env
dotenv.config();

export interface AppConfig {
  port: number;
  nodeEnv: string;
  sessionSecret: string;
  adminUsername: string;
  adminPasswordDefault: string;
  serialPort: string;
  serialBaudrate: number;
  serialAutoConnect: boolean;
  dbPath: string;
  defaultTariffM3: number;
  defaultCalibrationFactor: number;
  defaultMaxFlowLmin: number;
  defaultContinuousFlowLimitMin: number;
  defaultPollingIntervalMs: number;
  masterRecoveryKey: string;
}

export const config: AppConfig = {
  port: parseInt(process.env.DEV_PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  sessionSecret: process.env.SESSION_SECRET || 'sgh_offline_secret_key_2026_hydraulic',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPasswordDefault: process.env.ADMIN_PASSWORD || 'admin123',
  serialPort: process.env.SERIAL_PORT || 'COM3',
  serialBaudrate: parseInt(process.env.SERIAL_BAUDRATE || '115200', 10),
  serialAutoConnect: process.env.SERIAL_AUTO_CONNECT !== 'false',
  dbPath: process.env.DB_PATH || (
    process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT
      ? path.join('/tmp', 'sgh.sqlite3')
      : path.resolve(process.cwd(), 'data', 'sgh.sqlite3')
  ),
  defaultTariffM3: parseFloat(process.env.DEFAULT_TARIFF_M3 || '4.50'),
  defaultCalibrationFactor: parseFloat(process.env.DEFAULT_CALIBRATION_FACTOR || '7.5'),
  defaultMaxFlowLmin: parseFloat(process.env.DEFAULT_MAX_FLOW_LMIN || '30.0'),
  defaultContinuousFlowLimitMin: parseInt(process.env.DEFAULT_CONTINUOUS_FLOW_LIMIT_MIN || '45', 10),
  defaultPollingIntervalMs: parseInt(process.env.DEFAULT_POLLING_INTERVAL_MS || '1500', 10),
  masterRecoveryKey: process.env.MASTER_RECOVERY_KEY || 'SGH-RECOVERY-2026'
};
