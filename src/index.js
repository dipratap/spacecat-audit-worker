/*
 * Copyright 2023 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import wrap from '@adobe/helix-shared-wrap';
import { helixStatus } from '@adobe/helix-status';
import { Response } from '@adobe/fetch';
import secrets from '@adobe/helix-shared-secrets';
import dataAccess from '@adobe/spacecat-shared-data-access';
import { resolveSecretsName, sqsEventAdapter } from '@adobe/spacecat-shared-utils';

import sqs from './support/sqs.js';
import apex from './apex/handler.js';
import cwv from './cwv/handler.js';
import lhsDesktop from './lhs/handler-desktop.js';
import lhsMobile from './lhs/handler-mobile.js';
import notfound from './notfound/handler.js';
import sitemap from './sitemap/handler.js';
import canonical from './canonical/handler.js';
import backlinks from './backlinks/handler.js';
import experimentation from './experimentation/handler.js';
import conversion from './conversion/handler.js';
import essExperimentationDaily from './experimentation-ess/daily.js';
import essExperimentationAll from './experimentation-ess/all.js';
import costs from './costs/handler.js';

const HANDLERS = {
  apex,
  cwv,
  'lhs-mobile': lhsMobile,
  'lhs-desktop': lhsDesktop,
  404: notfound,
  sitemap,
  canonical,
  'broken-backlinks': backlinks,
  experimentation,
  conversion,
  'experimentation-ess-daily': essExperimentationDaily,
  'experimentation-ess-all': essExperimentationAll,
  costs,
};

function getElapsedSeconds(startTime) {
  const endTime = process.hrtime(startTime);
  const elapsedSeconds = endTime[0] + endTime[1] / 1e9;
  return elapsedSeconds.toFixed(2);
}

/**
 * This is the main function
 * @param {object} message the message object received from SQS
 * @param {UniversalContext} context the context of the universal serverless function
 * @returns {Response} a response
 */
async function run(message, context) {
  const { log } = context;
  const { type, url } = message;

  log.info(`Audit req received for url: ${url}`);

  const handler = HANDLERS[type];
  if (!handler) {
    const msg = `no such audit type: ${type}`;
    log.error(msg);
    return new Response('', { status: 404 });
  }

  const startTime = process.hrtime();

  try {
    const result = await (typeof handler.run === 'function' ? handler.run(message, context) : handler(message, context));

    log.info(`Audit for ${type} completed in ${getElapsedSeconds(startTime)} seconds`);

    return result;
  } catch (e) {
    log.error(`Audit failed after ${getElapsedSeconds(startTime)} seconds`, e);
    return new Response('', {
      status: e.statusCode || 500,
      headers: {
        'x-error': 'internal server error',
      },
    });
  }
}

export const main = wrap(run)
  .with(dataAccess)
  .with(sqsEventAdapter)
  .with(sqs)
  .with(secrets, { name: resolveSecretsName })
  .with(helixStatus);
