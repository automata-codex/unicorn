import AdventureSynthesis from './pages/AdventureSynthesis.svelte';
import CampaignDetail from './pages/CampaignDetail.svelte';
import CampaignList from './pages/CampaignList.svelte';
import CharacterCreate from './pages/CharacterCreate.svelte';
import CharacterEdit from './pages/CharacterEdit.svelte';
import CharacterView from './pages/CharacterView.svelte';
import DevComponents from './pages/DevComponents.svelte';
import NotFound from './pages/NotFound.svelte';
import OracleFilter from './pages/OracleFilter.svelte';
import Play from './pages/Play.svelte';
import SignIn from './pages/SignIn.svelte';

import type { RouteDefinition } from 'svelte-spa-router';

const routes: RouteDefinition = {
  '/': CampaignList,
  '/campaigns': CampaignList,
  '/signin': SignIn,
  '/dev/components': DevComponents,
  '/campaigns/:campaignId': CampaignDetail,
  '/campaigns/:campaignId/characters': CharacterView,
  '/campaigns/:campaignId/characters/new': CharacterCreate,
  '/campaigns/:campaignId/characters/edit': CharacterEdit,
  '/campaigns/:campaignId/oracle': OracleFilter,
  '/campaigns/:campaignId/adventures/:adventureId': AdventureSynthesis,
  '/campaigns/:campaignId/adventures/:adventureId/play': Play,
  '*': NotFound,
};

export default routes;
