import { mount } from 'svelte';

import 'modern-normalize';
import './themes/base.css';
import './themes/mothership.css';
import './lib/styles/typography.css';

import App from './App.svelte';

const app = mount(App, { target: document.getElementById('app')! });

export default app;
