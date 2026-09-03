declare namespace Cloudflare {
  interface Env {
    FILES: R2Bucket;
    ASSETS?: Fetcher;
    DEPLOYMENT_STAGE?: string;
    GRAY_ENVIRONMENT_ID?: string;
    BOOTSTRAP_SECRET?: string;
  }
}
