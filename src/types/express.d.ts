declare namespace Express {
  export interface Request {
    id?: string;
    user?: {
      id: string;
      phoneNumber: string;
      name?: string;
    };
  }
}
