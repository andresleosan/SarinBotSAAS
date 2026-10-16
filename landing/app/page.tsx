import { MarketingHome } from "../../src/components/marketing-home";

export default function ProductPage() {
  return <MarketingHome standalone publicAppUrl={process.env.SARIN_PUBLIC_APP_URL} />;
}
