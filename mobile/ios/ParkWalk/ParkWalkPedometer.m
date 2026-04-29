#import <CoreMotion/CoreMotion.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface ParkWalkPedometer : RCTEventEmitter <RCTBridgeModule>
@property(nonatomic, strong) CMPedometer *pedometer;
@end

@implementation ParkWalkPedometer

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[ @"ParkWalkPedometerUpdate" ];
}

RCT_EXPORT_METHOD(isStepCountingAvailable:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  resolve(@([CMPedometer isStepCountingAvailable]));
}

RCT_EXPORT_METHOD(getAuthorizationStatus:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  if (@available(iOS 11.0, *)) {
    switch ([CMPedometer authorizationStatus]) {
    case CMAuthorizationStatusNotDetermined:
      resolve(@"notDetermined");
      return;
    case CMAuthorizationStatusRestricted:
      resolve(@"restricted");
      return;
    case CMAuthorizationStatusDenied:
      resolve(@"denied");
      return;
    case CMAuthorizationStatusAuthorized:
      resolve(@"authorized");
      return;
    }
  }
  resolve(@"unknown");
}

RCT_EXPORT_METHOD(querySteps:(NSString *)fromIso
                  toIso:(NSString *)toIso
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  NSDate *fromDate = [self dateFromIso:fromIso];
  NSDate *toDate = [self dateFromIso:toIso];
  if (!fromDate || !toDate) {
    reject(@"invalid_date", @"Invalid ISO date", nil);
    return;
  }
  if (![CMPedometer isStepCountingAvailable]) {
    reject(@"unavailable", @"Step counting is not available", nil);
    return;
  }

  CMPedometer *pedometer = [[CMPedometer alloc] init];
  [pedometer queryPedometerDataFromDate:fromDate
                                 toDate:toDate
                            withHandler:^(CMPedometerData *_Nullable data, NSError *_Nullable error) {
                              if (error) {
                                reject(@"query_failed", error.localizedDescription, error);
                                return;
                              }
                              resolve([self payloadFromData:data startDate:fromDate endDate:toDate]);
                            }];
}

RCT_EXPORT_METHOD(startUpdates : (NSString *)fromIso)
{
  NSDate *fromDate = [self dateFromIso:fromIso];
  if (!fromDate || ![CMPedometer isStepCountingAvailable]) {
    return;
  }
  self.pedometer = [[CMPedometer alloc] init];
  [self.pedometer startPedometerUpdatesFromDate:fromDate
                                    withHandler:^(CMPedometerData *_Nullable data,
                                                  NSError *_Nullable error) {
                                      if (error || !data) {
                                        return;
                                      }
                                      NSDictionary *payload = [self payloadFromData:data
                                                                          startDate:fromDate
                                                                            endDate:[NSDate date]];
                                      dispatch_async(dispatch_get_main_queue(), ^{
                                        [self sendEventWithName:@"ParkWalkPedometerUpdate" body:payload];
                                      });
                                    }];
}

RCT_EXPORT_METHOD(stopUpdates)
{
  [self.pedometer stopPedometerUpdates];
  self.pedometer = nil;
}

- (NSDate *)dateFromIso:(NSString *)iso
{
  NSISO8601DateFormatter *formatter = [[NSISO8601DateFormatter alloc] init];
  formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime | NSISO8601DateFormatWithFractionalSeconds;
  return [formatter dateFromString:iso];
}

- (NSDictionary *)payloadFromData:(CMPedometerData *)data startDate:(NSDate *)startDate endDate:(NSDate *)endDate
{
  NSMutableDictionary *payload = [@{
    @"steps" : data.numberOfSteps ?: @0,
    @"startDate" : [self isoFromDate:startDate],
    @"endDate" : [self isoFromDate:endDate],
  } mutableCopy];
  if (data.distance) {
    payload[@"distanceMeters"] = data.distance;
  }
  if (data.currentPace) {
    payload[@"currentPaceSecondsPerMeter"] = data.currentPace;
  }
  if (data.currentCadence) {
    payload[@"currentCadenceStepsPerSecond"] = data.currentCadence;
  }
  return payload;
}

- (NSString *)isoFromDate:(NSDate *)date
{
  NSISO8601DateFormatter *formatter = [[NSISO8601DateFormatter alloc] init];
  return [formatter stringFromDate:date];
}

@end
