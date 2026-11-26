import { Spinner } from "@/components/ui/spinner";

export default function Loading() {
  return (
    <div className="flex h-dvh items-center justify-center p-6">
      <Spinner className="text-primary size-8" />
    </div>
  );
}
