import { Spinner } from "@/components/ui/spinner";

export default function Loading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <Spinner className="text-primary size-7" />
    </div>
  );
}
