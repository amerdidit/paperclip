import { Download, RefreshCw, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePWA } from "@/hooks/usePWA";

export function PWAPrompts() {
  const {
    canInstall,
    isInstalled,
    updateAvailable,
    isOffline,
    promptInstall,
    applyUpdate,
    dismissInstall,
    installDismissed,
  } = usePWA();

  return (
    <>
      {/* Install banner */}
      {canInstall && !isInstalled && !installDismissed && (
        <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md animate-in slide-in-from-bottom-4 fade-in duration-300">
          <div className="flex items-center gap-3 rounded-lg border bg-card p-4 shadow-lg">
            <Download className="size-5 shrink-0 text-primary" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Install Paperclip</p>
              <p className="text-xs text-muted-foreground">
                Add to your home screen for a faster experience
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button size="sm" onClick={promptInstall}>
                Install
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={dismissInstall}
                aria-label="Dismiss"
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Update available banner */}
      {updateAvailable && (
        <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md animate-in slide-in-from-bottom-4 fade-in duration-300">
          <div className="flex items-center gap-3 rounded-lg border bg-card p-4 shadow-lg">
            <RefreshCw className="size-5 shrink-0 text-primary" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Update available</p>
              <p className="text-xs text-muted-foreground">
                A new version of Paperclip is ready
              </p>
            </div>
            <Button size="sm" onClick={applyUpdate}>
              Update
            </Button>
          </div>
        </div>
      )}

      {/* Offline indicator */}
      {isOffline && (
        <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 bg-yellow-600 px-3 py-1.5 text-xs font-medium text-white">
          <WifiOff className="size-3.5" />
          <span>You're offline — some features may be unavailable</span>
        </div>
      )}
    </>
  );
}
