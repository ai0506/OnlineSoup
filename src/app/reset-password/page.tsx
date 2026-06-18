import { ResetPasswordForm } from "@/components/reset-password-form";
import { getFlashMessage } from "@/lib/flash";

type ResetPasswordPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const { error } = await searchParams;
  const flash = await getFlashMessage("reset-password");
  const errorCode = flash?.kind === "error" ? flash.code : error;

  return <ResetPasswordForm initialError={errorCode ?? null} />;
}
