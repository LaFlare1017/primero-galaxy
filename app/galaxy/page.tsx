import { getCompanies } from '@/lib/data-generator';
import { COMPANY_COUNT } from '@/lib/constants';
import GalaxyApp from '@/components/galaxy/GalaxyApp';

export default function GalaxyPage() {
  const companies = getCompanies(COMPANY_COUNT);
  return <GalaxyApp companies={companies} />;
}
