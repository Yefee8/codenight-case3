import { CustomerPortal } from "@/components/customer-portal";
import { requireRole } from "@/lib/server/auth";
import { listCasesFor } from "@/lib/server/fraud-service";

export default async function CustomerPage() {
  const user = await requireRole(["CUSTOMER"]);
  return <CustomerPortal initialCases={await listCasesFor(user)} />;
}
