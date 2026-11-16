import { useQuery } from '@tanstack/react-query';
import { fetchNucData } from '@/lib/nuc';

export function useNucData() {
  return useQuery({ queryKey: ['nuc-data'], queryFn: fetchNucData });
}
