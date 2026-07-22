import { CustomerPortal } from "@/components/customer-portal";
import { requireRole } from "@/lib/server/auth";

export default async function CustomerPage() {
  await requireRole(["CUSTOMER", "ADMIN"]);
  return <CustomerPortal />;
}
