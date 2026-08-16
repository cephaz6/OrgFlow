import { SendEmailCommand, SESClient, type SESClientConfig } from '@aws-sdk/client-ses';

import type { EmailMessage, EmailSender } from './sender.js';

export interface SesSenderConfig {
  fromAddress: string;
  region: string;
  // Set to the LocalStack endpoint locally; left undefined in a deployed
  // environment so the SDK resolves the real service endpoint itself.
  endpoint?: string | undefined;
}

export function createSesSender(config: SesSenderConfig): EmailSender {
  const clientConfig: SESClientConfig = { region: config.region };
  if (config.endpoint) {
    clientConfig.endpoint = config.endpoint;
    // LocalStack accepts any credentials, but the SDK refuses to sign a
    // request without some.
    clientConfig.credentials = { accessKeyId: 'test', secretAccessKey: 'test' };
  }

  const client = new SESClient(clientConfig);

  return {
    async send(message: EmailMessage): Promise<void> {
      await client.send(
        new SendEmailCommand({
          Source: config.fromAddress,
          Destination: { ToAddresses: [message.to] },
          Message: {
            Subject: { Data: message.subject, Charset: 'UTF-8' },
            Body: {
              Text: { Data: message.textBody, Charset: 'UTF-8' },
              Html: { Data: message.htmlBody, Charset: 'UTF-8' },
            },
          },
        }),
      );
    },
  };
}
