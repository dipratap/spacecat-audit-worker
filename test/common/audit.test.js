/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/* eslint-env mocha */
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import nock from 'nock';
import { createSite } from '@adobe/spacecat-shared-data-access/src/models/site.js';
import { createOrganization } from '@adobe/spacecat-shared-data-access/src/models/organization.js';
import { createConfiguration } from '@adobe/spacecat-shared-data-access/src/models/configuration.js';
import { composeAuditURL, prependSchema } from '@adobe/spacecat-shared-utils';
import {
  defaultMessageSender, defaultOrgProvider,
  defaultPersister,
  defaultSiteProvider,
  defaultUrlResolver, noopUrlResolver,
} from '../../src/common/audit.js';
import { AuditBuilder } from '../../src/common/audit-builder.js';
import { MockContextBuilder } from '../shared.js';
import { getUrlWithoutPath } from '../../src/support/utils.js';

use(sinonChai);
use(chaiAsPromised);

const baseURL = 'https://space.cat';
const message = {
  type: 'dummy',
  url: 'site-id',
  auditContext: { someField: 431 },
};
const mockDate = '2023-03-12T15:24:51.231Z';
const sandbox = sinon.createSandbox();
describe('Audit tests', () => {
  let context;
  let site;
  let org;
  let configuration;

  beforeEach('setup', () => {
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .build(message);

    org = createOrganization({ name: 'some-org' });
    site = createSite({ baseURL, organizationId: org.getId() });
    const configurationData = {
      version: '1.0',
      queues: {},
      handlers: {
        dummy: {
          enabled: {
            sites: ['site-id', 'space.cat', site.getId()],
            orgs: ['some-org', 'org2', org.getId()],
          },
          enabledByDefault: false,
          dependencies: [],
        },
      },
      jobs: [],
    };
    configuration = createConfiguration(configurationData);
  });

  before('setup', function () {
    this.clock = sandbox.useFakeTimers({
      now: new Date(mockDate).getTime(),
    });
  });

  after('clean', function () {
    this.clock.uninstall();
  });

  describe('default components', () => {
    it('default site provider throws error when site is not found', async () => {
      context.dataAccess.getSiteByID.withArgs(message.url).resolves(null);
      await expect(defaultSiteProvider(message.url, context))
        .to.be.rejectedWith(`Site with id ${message.url} not found`);
    });

    it('default site provider returns site', async () => {
      context.dataAccess.getSiteByID.withArgs(message.url).resolves(site);

      const result = await defaultSiteProvider(message.url, context);
      expect(result.getBaseURL()).to.equal(baseURL);

      expect(context.dataAccess.getSiteByID).to.have.been.calledOnce;
    });

    it('default org provider throws error when org is not found', async () => {
      context.dataAccess.getOrganizationByID.withArgs(site.getOrganizationId()).resolves(null);
      await expect(defaultOrgProvider(site.getOrganizationId(), context))
        .to.be.rejectedWith(`Org with id ${site.getOrganizationId()} not found`);
    });

    it('default org provider returns org', async () => {
      context.dataAccess.getOrganizationByID.withArgs(site.getOrganizationId()).resolves(org);

      const result = await defaultOrgProvider(site.getOrganizationId(), context);
      expect(result.getId()).to.equal(site.getOrganizationId());

      expect(context.dataAccess.getOrganizationByID).to.have.been.calledOnce;
    });

    it('default persister saves the audit result to data access', async () => {
      context.dataAccess.addAudit.resolves();
      const auditData = { result: 'hebele' };

      await defaultPersister(auditData, context);

      expect(context.dataAccess.addAudit).to.have.been.calledOnce;
      expect(context.dataAccess.addAudit).to.have.been.calledWith(auditData);
    });

    it('default message sender sends the audit to sqs', async () => {
      const queueUrl = 'some-queue-url';
      context.env = { AUDIT_RESULTS_QUEUE_URL: queueUrl };
      context.sqs.sendMessage.resolves();

      const resultMessage = { result: 'hebele' };

      await defaultMessageSender(resultMessage, context);

      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      expect(context.sqs.sendMessage).to.have.been.calledWith(queueUrl, resultMessage);
    });

    it('default url resolves gets the base url and follows redirects', async () => {
      const finalUrl = 'www.space.cat';

      nock(baseURL)
        .get('/')
        .reply(301, undefined, { Location: `https://${finalUrl}/` });

      nock(`https://${finalUrl}`)
        .get('/')
        .reply(200, 'Success');

      const url = await defaultUrlResolver(site);

      expect(url).to.equal(finalUrl);
    });

    it('no-op url resolver returns the base url only', async () => {
      const url = await noopUrlResolver(site);
      expect(url).to.equal(baseURL);
    });
  });

  describe('audit runner', () => {
    it('audit fails when built without a runner', async () => {
      expect(() => new AuditBuilder().build()).to.throw('"runner" must be a function');
    });

    it('audit run fails when an underlying audit step throws an error', async () => {
      const dummyRummer = () => 123;
      const audit = new AuditBuilder()
        .withRunner(dummyRummer)
        .build();

      await expect(audit.run(message, context))
        .to.be.rejectedWith(`${message.type} audit failed for site ${message.url}. Reason: Site with id ${message.url} not found`);
    });

    it('should follow redirection and return final URL', async () => {
      nock('https://spacekitty.cat')
        .get('/blog')
        .reply(301, undefined, { Location: 'https://www.spacekitty.cat/blog' });

      nock('https://www.spacekitty.cat')
        .get('/blog')
        .reply(200, () => 'hello world', {});

      const testsite = createSite({ baseURL: 'https://spacekitty.cat/blog', organizationId: org.getId() });
      const initialBaseURL = testsite.getBaseURL();
      const auditURL = await composeAuditURL(initialBaseURL);
      const urlWithSchema = prependSchema(auditURL);
      const finalURL = getUrlWithoutPath(urlWithSchema);

      expect(finalURL).to.equal('https://www.spacekitty.cat');
    });

    it('audit run skips when audit is disabled', async () => {
      configuration.disableHandlerForSite('dummy', { getId: () => site.getId(), getOrganizationId: () => org.getId() });
      configuration.disableHandlerForOrg('dummy', org);
      const queueUrl = 'some-queue-url';
      context.env = { AUDIT_RESULTS_QUEUE_URL: queueUrl };
      context.dataAccess.getSiteByID.withArgs(message.url).resolves(site);
      context.dataAccess.getOrganizationByID.withArgs(site.getOrganizationId()).resolves(org);
      context.dataAccess.getConfiguration = sinon.stub().resolves(configuration);

      const audit = new AuditBuilder()
        .withRunner(() => 123)
        .build();

      const resp = await audit.run(message, context);

      expect(resp.status).to.equal(200);
      expect(context.log.warn).to.have.been.calledWith('dummy audits disabled for site site-id, skipping...');
    });

    it('audit runs as expected with post processors', async () => {
      const queueUrl = 'some-queue-url';
      context.env = { AUDIT_RESULTS_QUEUE_URL: queueUrl };
      context.dataAccess.getSiteByID.withArgs(message.url).resolves(site);
      context.dataAccess.getOrganizationByID.withArgs(site.getOrganizationId()).resolves(org);
      context.dataAccess.getConfiguration = sinon.stub().resolves(configuration);
      context.dataAccess.addAudit.resolves();
      context.sqs.sendMessage.resolves();

      const postProcessors = [
        sandbox.stub().resolves(), sandbox.stub().resolves(),
      ];

      nock(baseURL)
        .get('/')
        .reply(200);

      const fullAuditRef = 'hebele';
      const dummyRunner = (url, _context) => ({
        auditResult: typeof url === 'string' && typeof _context === 'object' ? { metric: 42 } : null,
        fullAuditRef,
      });

      // Act
      const audit = new AuditBuilder()
        .withSiteProvider(defaultSiteProvider)
        .withUrlResolver(defaultUrlResolver)
        .withRunner(dummyRunner)
        .withPersister(defaultPersister)
        .withMessageSender(defaultMessageSender)
        .withPostProcessors(postProcessors)
        .build();

      const resp = await audit.run(message, context);

      // Assert
      expect(resp.status).to.equal(200);

      expect(context.dataAccess.addAudit).to.have.been.calledOnce;
      const auditData = {
        siteId: site.getId(),
        isLive: site.isLive(),
        auditedAt: mockDate,
        auditType: message.type,
        auditResult: { metric: 42 },
        fullAuditRef,
      };
      expect(context.dataAccess.addAudit).to.have.been.calledWith(auditData);

      const finalUrl = 'space.cat';
      const expectedMessage = {
        type: message.type,
        url: 'https://space.cat',
        auditContext: { someField: 431, finalUrl, fullAuditRef },
        auditResult: { metric: 42 },
      };
      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      expect(context.sqs.sendMessage).to.have.been.calledWith(queueUrl, expectedMessage);
      expect(postProcessors[0]).to.have.been.calledWith(finalUrl, auditData);
      expect(postProcessors[1]).to.have.been.calledWith(finalUrl, auditData);
    });
  });

  it('audit runs as expected when receiving siteId instead of message ', async () => {
    const queueUrl = 'some-queue-url';
    context.env = { AUDIT_RESULTS_QUEUE_URL: queueUrl };
    context.dataAccess.getSiteByID.withArgs(message.url).resolves(site);
    context.dataAccess.getOrganizationByID.withArgs(site.getOrganizationId()).resolves(org);
    context.dataAccess.getConfiguration = sinon.stub().resolves(configuration);
    context.dataAccess.addAudit.resolves();
    context.sqs.sendMessage.resolves();

    nock(baseURL)
      .get('/')
      .reply(200);

    const fullAuditRef = 'hebele';
    const dummyRunner = (url, _context) => ({
      auditResult: typeof url === 'string' && typeof _context === 'object' ? { metric: 42 } : null,
      fullAuditRef,
    });

    // Act
    const audit = new AuditBuilder()
      .withSiteProvider(defaultSiteProvider)
      .withUrlResolver(defaultUrlResolver)
      .withRunner(dummyRunner)
      .withPersister(defaultPersister)
      .withMessageSender(defaultMessageSender)
      .build();

    const siteIdMessage = { siteId: message.url, type: message.type };
    const resp = await audit.run(siteIdMessage, context);

    // Assert
    expect(resp.status).to.equal(200);

    expect(context.dataAccess.addAudit).to.have.been.calledOnce;
    expect(context.dataAccess.addAudit).to.have.been.calledWith({
      siteId: site.getId(),
      isLive: site.isLive(),
      auditedAt: mockDate,
      auditType: message.type,
      auditResult: { metric: 42 },
      fullAuditRef,
    });

    const expectedMessage = {
      type: message.type,
      url: 'https://space.cat',
      auditContext: { finalUrl: 'space.cat', fullAuditRef },
      auditResult: { metric: 42 },
    };
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been.calledWith(queueUrl, expectedMessage);
  });
});
