interface LinkedInSduiNodeProps {
  className?: string;
  role?: string;
  'data-sdui-screen'?: string;
  children?: SduiNodeChild[];
  isOops?: boolean;
  errorMessage?: string;
  screenId?: string;
  treeId?: string;
  legacyPemRatio?: string;
  dataFetchMeta?: DataFetchMeta;
  titleText?: string;
  renderedTitle?: string[];
  modelStates?: ModelState[];
}

type SduiNodeChild = ['$', string, null, LinkedInSduiNodeProps] | any[];

interface DataFetchMeta {
  startTime: number;
  responseCode: number;
}

interface ModelState {
  key: ModelStateKey;
  value: ModelStateValue;
  persistence?: StatePersistence;
}

interface ModelStateKey {
  key: {
    value: {
      $case: 'id';
      id: string;
    };
  };
  namespace?: string;
}

interface ModelStateValue {
  $case: 'stringValue';
  stringValue: string;
}

interface StatePersistence {
  $type: string;
  clientTtlDuration: Duration;
}

interface Duration {
  $type: string;
  seconds: string;
  nanos: number;
}
