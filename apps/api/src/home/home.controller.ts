import { Controller, Get } from '@nestjs/common';
import { Access, Auth, type AuthContext } from '../common/context';
import { HomeService } from './home.service';

@Controller('home')
export class HomeController {
  constructor(private readonly home: HomeService) {}

  @Access('view', 'home')
  @Get()
  get(@Auth() auth: AuthContext) {
    return this.home.get(auth);
  }
}
