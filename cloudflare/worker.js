import providers from '../providers.json';
import profiles from '../profiles.json';
import system from '../prompts/literary-system.txt';
import review from '../prompts/review.txt';
import revise from '../prompts/revise.txt';
import { createWorker } from './engine.mjs';

export default createWorker({providers, profiles, prompts: {system, review, revise}});
