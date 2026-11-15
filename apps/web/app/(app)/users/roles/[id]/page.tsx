import { redirect } from 'next/navigation';

/** Roles open inside Users & roles › Roles (prototype: the permissions grid sits in the Roles tab). */
export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/users?tab=roles&role=${encodeURIComponent(id)}`);
}
