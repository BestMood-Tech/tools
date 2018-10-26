import { SES } from 'aws-sdk';

import { log } from '@helper/logger';

export class SESService {
  private ses: SES;

  constructor() {
    this.ses = new SES();
  }

  public sendEmail(emails: string[], body: string, subject: string, source: string) {
    const params = {
      Destination: {
        ToAddresses: [
          ...emails
        ]
      },
      Message: {
        Body: {
          Text: {
            Charset: "UTF-8",
            Data: body,
          }
        },
        Subject: {
          Charset: 'UTF-8',
          Data: subject,
        }
      },
      Source: source,
    };

    return this.ses.sendEmail(params).promise()
      .catch(e => log('Email error', e));
  }
}