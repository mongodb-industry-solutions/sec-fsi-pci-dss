import { Db } from 'mongodb';
import { PAYMENT_EXECUTION_COLLECTION } from '../../modules/gateway/models/paymentExecution.model';

// No demo execution records at seed time — executions are created by PayoutOrchestrationProcess.
export async function seedPaymentExecutions(db: Db) {
  void db;
  console.log(`  ${PAYMENT_EXECUTION_COLLECTION}: skipped (created at runtime by orchestration)`);
}
