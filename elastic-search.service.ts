import { log } from '@helper/logger';
import { EnvironmentCredentials, HttpRequest } from 'aws-sdk';
import * as ES from 'aws-sdk/clients/es';
import { DescribeElasticsearchDomainResponse } from 'aws-sdk/clients/es';
import * as querystring from 'querystring';

const AWS = require('aws-sdk');

export class ElasticSearchService {
  private elasticSearch: ES;

  constructor() {
    this.elasticSearch = new ES();
  }

  public async putDocument(index: string, type: string, id: string, document: any, domainName: string = process.env.ELASTIC_SEARCH_DOMAIN): Promise<any> {
    const request = await this.getRequest(JSON.stringify(document), 'POST', `/${index}/${type}/${id}`, domainName);
    return this.sendRequest(request);
  }

  public async removeDocument(index: string, type: string, id: string, domainName: string = process.env.ELASTIC_SEARCH_DOMAIN): Promise<any> {
    const request = await this.getRequest(null, 'DELETE', `/${index}/${type}/${id}`, domainName);
    return this.sendRequest(request);
  }

  public async search(index: string, type: string, query: string, domainName: string = process.env.ELASTIC_SEARCH_DOMAIN): Promise<any> {
    const request = await this.getRequest(query, 'POST', `/${index}/${type}/_search?pretty=true`, domainName);
    return this.sendRequest(request);
  }

  /**
   * Method for creating Elasticsearch index, should be used after first deploy for each index if you have some
   * special types of data
   * @param {string} index
   * @returns {Promise<any>}
   */
  public async createIndex(index: string, domainName: string = process.env.ELASTIC_SEARCH_DOMAIN): Promise<any> {
    const request = await this.getRequest('{}', 'PUT', `/${index}`, domainName);
    return this.sendRequest(request);
  }

  /**
   * Method for deleting Elasticsearch index
   * @param {string} index
   * @returns {Promise<any>}
   */
  public async deleteIndex(index: string, domainName: string = process.env.ELASTIC_SEARCH_DOMAIN): Promise<any> {
    const request = await this.getRequest(null, 'DELETE', `/${index}`, domainName);
    return this.sendRequest(request);
  }

  /**
   * Method for setting mapping for index with some type, should be used after first deploy for each index if you have some
   * special types of data
   * @param {string} index
   * @param {string} type
   * @param {string} mapping
   * @returns {Promise<any>}
   */
  public async setMapping(index: string, type: string, mapping: string, domainName: string = process.env.ELASTIC_SEARCH_DOMAIN): Promise<any> {
    const request = await this.getRequest(mapping, 'PUT', `/${index}/_mapping/${type}`, domainName);
    return this.sendRequest(request);
  }

  private async getRequest(body: string, method: string, path: string, domainName: string): Promise<HttpRequest> {
    const domain: DescribeElasticsearchDomainResponse = await this.elasticSearch
      .describeElasticsearchDomain({ DomainName: domainName }).promise();
    log('domain', domain);

    const endpoint = domain.DomainStatus.Endpoint;
    log('endpoint', endpoint);

    const credentials = new EnvironmentCredentials('AWS');
    log('credentials', credentials);

    const request = new HttpRequest(endpoint as any, process.env.REGION);
    request.method = method;
    request.path = path;
    request.headers['Host'] = endpoint;
    request.headers['Content-Type'] = 'application/json';
    request.body = body ? body : '';

    log('request', request);

    const signer = new AWS.Signers.V4(request, 'es');
    signer.addAuthorization(credentials, new Date());
    log('signer', signer);

    return Promise.resolve(request);
  }

  private sendRequest(request: HttpRequest): Promise<any> {
    const send = new AWS.NodeHttpClient();
    return new Promise((resolve, reject) =>
      send.handleRequest(request, null,
        (response) => {
          let result;
          response.on('end', (data) => {
            log('end', data);
            resolve(result);
          });
          response.on('data', (data) => {
            try {
              result = JSON.parse(querystring.unescape(data.toString()));
            }
            catch (e) {
              log(e);
              reject(e);
            }
            log('data', result);
          });
        },
        (e) => reject(e),
      ),
    );
  }
}