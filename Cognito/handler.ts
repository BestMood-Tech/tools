import { ISignUpResult } from 'amazon-cognito-identity-js';
import * as jose from 'node-jose';
import * as request from 'request-promise-native';

import { SignInUser, User, UserModel } from '@models/User';
import { AmazonCognitoService } from '@services/amazon-cognito.service';
import { CloudFormationService, OutputsMap } from '@services/cloud-formation.service';
import { errorHandler } from '@helper/error-handler';
import { log } from '@helper/logger';

export async function signUp(event) {
  log('event', event);

  try {
    /**
     * 1. Get UserPoolId and UserPoolClientId from CloudFormation outputs
     */
    const cloudFormationService = new CloudFormationService();
    const outputs: OutputsMap = await cloudFormationService.getOutputs(['UserPoolId', 'UserPoolClientId']);
    log('outputs', outputs);

    /**
     * 2. Create UserPool
     */
    const poolData = {
      UserPoolId: outputs.UserPoolId && outputs.UserPoolId.OutputValue,
      ClientId: outputs.UserPoolClientId && outputs.UserPoolClientId.OutputValue,
    };
    const amazonCognitoService = new AmazonCognitoService(poolData);

    /**
     * 3. Register new user and save to dynamodb
     */
    const user: User = new User(event.body);
    let registeredUser: ISignUpResult = await amazonCognitoService.signUp(user);
    log('registered user', registeredUser);
    user.id = registeredUser.userSub;
    const createdUser = await UserModel.create(user);
    log('created user', createdUser);

    return {
      message: 'You can log in to your account after confirming the email. A confirmation email was sent',
    };
  } catch (e) {
    log(e);
    errorHandler(e);
  }
}

export async function signIn(event) {
  log('event', event);

  try {
    /**
     * 1. Get UserPoolId and UserPoolClientId from CloudFormation outputs
     */
    const cloudFormationService = new CloudFormationService();
    const outputs: OutputsMap = await cloudFormationService.getOutputs(['UserPoolId', 'UserPoolClientId']);
    log('outputs', outputs);

    /**
     * 2. Create UserPool
     */
    const poolData = {
      UserPoolId: outputs.UserPoolId && outputs.UserPoolId.OutputValue,
      ClientId: outputs.UserPoolClientId && outputs.UserPoolClientId.OutputValue,
    };
    const amazonCognitoService = new AmazonCognitoService(poolData);

    /**
     * 3. Authenticate user
     */
    const user: SignInUser = event.body;

    return await amazonCognitoService.signIn(user);
  } catch (e) {
    log(e);
    errorHandler(e);
  }
}

export async function authentication(event) {
  log('event', event);
  if (!event.authorizationToken || !event.methodArn) {
    throw Error('Unauthorized');
  }

  try {
    /**
     * 1. Get UserPoolId from CloudFormation outputs and form keys url
     */
    const cloudFormationService = new CloudFormationService();
    const outputs: OutputsMap = await cloudFormationService.getOutputs(['UserPoolId', 'UserPoolClientId']);
    log('outputs', outputs);
    const keysUrl = `https://cognito-idp.${process.env.REGION}.amazonaws.com/${outputs.UserPoolId.OutputValue}/.well-known/jwks.json`;

    /**
     * 2. Split token, decode header for getting kid
     */
    const sections = event.authorizationToken.split('.');
    const header = JSON.parse(jose.util.base64url.decode(sections[0]));
    const kid = header.kid;
    log('header', header);

    /**
     * 3. Get public keys form Cognito User Pool and find needed key via kid
     */
    const options = {
      method: 'GET',
      uri: keysUrl,
      json: true,
    };
    log(options);
    const keys = await request(options);
    log('keys', keys);
    const key = keys.keys.find((key) => key.kid === kid);

    if (!key) {
      log('Public key not found in jwks.json');
      throw Error('Unauthorized');
    }

    /**
     * 4. Construct public key
     */
    const publicKey = await jose.JWK.asKey(key);
    log('public key', publicKey);

    /**
     * 5. Verify the signature
     */
    const data = await jose.JWS.createVerify(publicKey).verify(event.authorizationToken);
    log('token data', data);

    /**
     * 6. Check token data
     */
    const claims = JSON.parse(data.payload);
    log('claims', claims);
    const currentTime = Math.floor(Date.now() / 1000);
    if (currentTime > claims.exp && !event.methodArn.includes('refresh')) {
      log('Token is expired');
      throw Error('Unauthorized');
    }
    return generatePolicy(claims.sub, 'Allow', event.methodArn);
  } catch (e) {
    log(e);
    throw Error('Unauthorized');
  }
}

export async function refresh(event) {
  log('event', event);

  try {
    /**
     * 1. Get UserPoolId from CloudFormation outputs and form keys url
     */
    const cloudFormationService = new CloudFormationService();
    const outputs: OutputsMap = await cloudFormationService.getOutputs(['UserPoolId', 'UserPoolClientId']);
    log('outputs', outputs);

    /**
     * 2. Create UserPool
     */
    const poolData = {
      UserPoolId: outputs.UserPoolId && outputs.UserPoolId.OutputValue,
      ClientId: outputs.UserPoolClientId && outputs.UserPoolClientId.OutputValue,
    };
    const amazonCognitoService = new AmazonCognitoService(poolData);

    /**
     * Refresh tokens
     */
    return await amazonCognitoService.refresh(event.principalId, event.body.refreshToken);
  } catch (e) {
    log(e);
    errorHandler(e);
  }
}

function generatePolicy(principalId, effect, resource) {
  if (!effect || !resource) {
    return {
      principalId: principalId,
    };
  }
  return {
    principalId: principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [{
        Action: 'execute-api:Invoke',
        Effect: effect,
        Resource: resource,
      }],
    },
  };
}