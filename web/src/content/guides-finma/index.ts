/** Les trois guides FINMA, indexés par leur adresse commune aux trois langues. */
import type { GuideDefinition, GuideId } from '../../lib/guides';
import { authorisationCheck } from './authorisation-check';
import { warningList } from './warning-list';
import { screeningAutomation } from './screening-automation';

export const GUIDES: Record<GuideId, GuideDefinition> = {
  'finma-authorisation-check': authorisationCheck,
  'finma-warning-list': warningList,
  'finma-screening-automation': screeningAutomation,
};
