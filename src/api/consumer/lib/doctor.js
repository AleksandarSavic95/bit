/** @flow */
import os from 'os';
import tar from 'tar-stream';
import fs from 'fs-extra';
import Stream from 'stream';
import registerCoreAndExtensionsDiagnoses from '../../../doctor/doctor-registrar-builder';
import DoctorRegistrar from '../../../doctor/doctor-registrar';
import Diagnosis from '../../../doctor/Diagnosis';
import { getWithoutExt, getExt } from '../../../utils';
import type { ExamineResult } from '../../../doctor/Diagnosis';
import logger from '../../../logger/logger';
import { DEBUG_LOG, BIT_VERSION, CFG_USER_NAME_KEY, CFG_USER_EMAIL_KEY } from '../../../constants';
import * as globalConfig from './global-config';

// load all diagnosis
// list checks
// run all checks
// run specific check

export type DoctorRunAllResults = { examineResults: ExamineResult[], savedFilePath: ?string };

let runningTimeStamp;

export default (async function runAll({ filePath }: { filePath?: string }): Promise<DoctorRunAllResults> {
  registerCoreAndExtensionsDiagnoses();
  runningTimeStamp = _getTimeStamp();
  const doctorRegistrar = DoctorRegistrar.getInstance();
  const examineP = doctorRegistrar.diagnoses.map(diagnosis => diagnosis.examine());
  const examineResults = await Promise.all(examineP);
  const savedFilePath = await _saveExamineResultsToFile(examineResults, filePath);
  return { examineResults, savedFilePath };
});

export async function listDiagnoses(): Promise<Diagnosis[]> {
  registerCoreAndExtensionsDiagnoses();
  const doctorRegistrar = DoctorRegistrar.getInstance();
  return Promise.resolve(doctorRegistrar.diagnoses);
}

async function _saveExamineResultsToFile(examineResults: ExamineResult[], filePath: ?string): Promise<?string> {
  if (!filePath) {
    return Promise.resolve(undefined);
  }
  const finalFilePath = _calculateFinalFileName(filePath);
  const packStream = await _generateExamineResultsTarFile(examineResults);

  const yourTarball = fs.createWriteStream(finalFilePath);

  packStream.pipe(yourTarball);

  return new Promise((resolve) => {
    yourTarball.on('close', function () {
      logger.info(`wrote a file by bit doctor, file path: ${finalFilePath}`);
      resolve(finalFilePath);
      // fs.stat(finalFilePath, function (err, stats) {
      //   if (err) throw err
      //   console.log(stats)
      //   console.log('Got file info successfully!')
      // })
    });
  });
}

function _calculateFinalFileName(fileName: string): string {
  if (fileName === '.') {
    return _getDefaultFileName();
  }
  let finalFileName = fileName;
  if (getExt(fileName) !== 'tar' && getExt(fileName) !== 'tar.gz') {
    finalFileName = `${getWithoutExt(finalFileName)}.tar`;
  }
  return finalFileName;
}

function _getDefaultFileName() {
  const timestamp = runningTimeStamp || _getTimeStamp();
  return `doctor-results-${timestamp}.tar`;
}

// TODO: move to utils
function _getTimeStamp() {
  const d = new Date();
  const timestamp = d.getTime();
  return timestamp;
}

async function _generateExamineResultsTarFile(examineResults: ExamineResult[]): Promise<Stream.Readable> {
  const pack = tar.pack(); // pack is a streams2 stream
  const debugLog = await _getDebugLogAsStream();
  const env = _getEnvMeta();
  pack.entry({ name: 'env-meta.json' }, JSON.stringify(env, null, 2));
  pack.entry({ name: 'doc-results.json' }, JSON.stringify(examineResults, null, 2));
  if (debugLog) {
    pack.entry({ name: 'debug.log' }, debugLog);
  }
  pack.finalize();

  return pack;
}

function _getEnvMeta(): Object {
  const env = {
    'node-version': process.version,
    'running-timestamp': runningTimeStamp || _getTimeStamp(),
    platform: os.platform(),
    'bit-version': BIT_VERSION,
    'user-details': _getUserDetails()
  };

  return env;
}

function _getUserDetails(): string {
  const name = globalConfig.getSync(CFG_USER_NAME_KEY) || '';
  const email = globalConfig.getSync(CFG_USER_EMAIL_KEY) || '';
  return `${name}<${email}>`;
}

async function _getDebugLogAsStream(): Promise<?Buffer> {
  const exists = fs.exists(DEBUG_LOG);
  if (exists) {
    return fs.readFile(DEBUG_LOG);
  }
  return Promise.resolve(undefined);
}
