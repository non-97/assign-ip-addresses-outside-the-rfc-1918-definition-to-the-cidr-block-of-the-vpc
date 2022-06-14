import { Stack, StackProps, aws_iam as iam, aws_ec2 as ec2 } from "aws-cdk-lib";
import { Construct } from "constructs";

export class VpcStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // SSM IAM Role
    const ssmIamRole = new iam.Role(this, "SSM IAM Role", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMManagedInstanceCore"
        ),
      ],
    });

    // VPC
    const vpcA = new ec2.Vpc(this, "VPC A", {
      cidr: "192.0.2.0/24",
      enableDnsHostnames: true,
      enableDnsSupport: true,
      natGateways: 1,
      maxAzs: 1,
      subnetConfiguration: [
        { name: "Public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 28 },
        {
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
          cidrMask: 28,
        },
        {
          name: "Isolated",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 28,
        },
      ],
      gatewayEndpoints: {
        S3: {
          service: ec2.GatewayVpcEndpointAwsService.S3,
        },
      },
    });

    const vpcB = new ec2.Vpc(this, "VPC B", {
      cidr: "198.51.100.0/24",
      enableDnsHostnames: true,
      enableDnsSupport: true,
      natGateways: 0,
      maxAzs: 1,
      subnetConfiguration: [
        { name: "Public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 28 },
      ],
    });

    // VPC Endpoint
    // SSM
    new ec2.InterfaceVpcEndpoint(this, "SSM VPC Endpoint", {
      vpc: vpcA,
      service: ec2.InterfaceVpcEndpointAwsService.SSM,
      subnets: vpcA.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      }),
    });

    // SSM Messages
    new ec2.InterfaceVpcEndpoint(this, "SSM Messages M VPC Endpoint", {
      vpc: vpcA,
      service: ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,
      subnets: vpcA.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      }),
    });

    // EC2 Message
    new ec2.InterfaceVpcEndpoint(this, "EC2 Messages VPC Endpoint", {
      vpc: vpcA,
      service: ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,
      subnets: vpcA.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      }),
    });

    // VPC Peering
    const vpcPeeringConnection = new ec2.CfnVPCPeeringConnection(
      this,
      "VPC Peering connection",
      {
        vpcId: vpcA.vpcId,
        peerVpcId: vpcB.vpcId,
      }
    );

    // Route to VPC Peering connection
    vpcA.publicSubnets.map((iSubnet: ec2.ISubnet, index: number) => {
      new ec2.CfnRoute(
        this,
        `Route to VPC Peering connection of public subnet in VPC A ${index}`,
        {
          routeTableId: iSubnet.routeTable.routeTableId,
          destinationCidrBlock: vpcB.vpcCidrBlock,
          vpcPeeringConnectionId: vpcPeeringConnection.ref,
        }
      );
    });
    vpcB.publicSubnets.map((iSubnet: ec2.ISubnet, index: number) => {
      new ec2.CfnRoute(
        this,
        `Route to VPC Peering connection of public subnet in VPC B ${index}`,
        {
          routeTableId: iSubnet.routeTable.routeTableId,
          destinationCidrBlock: vpcA.vpcCidrBlock,
          vpcPeeringConnectionId: vpcPeeringConnection.ref,
        }
      );
    });

    // Security Group
    const vpcAEC2InstanceSG = new ec2.SecurityGroup(
      this,
      "VPC A EC2 Instance SG",
      {
        vpc: vpcA,
        description: "",
        allowAllOutbound: true,
      }
    );
    vpcAEC2InstanceSG.addIngressRule(
      ec2.Peer.ipv4(vpcA.vpcCidrBlock),
      ec2.Port.icmpPing()
    );
    vpcAEC2InstanceSG.addIngressRule(
      ec2.Peer.ipv4(vpcB.vpcCidrBlock),
      ec2.Port.icmpPing()
    );

    const vpcBEC2InstanceSG = new ec2.SecurityGroup(
      this,
      "VPC B EC2 Instance SG",
      {
        vpc: vpcB,
        description: "",
        allowAllOutbound: true,
      }
    );
    vpcBEC2InstanceSG.addIngressRule(
      ec2.Peer.ipv4(vpcA.vpcCidrBlock),
      ec2.Port.icmpPing()
    );

    // EC2 Instance
    new ec2.Instance(this, "EC2 Instance on VPC A public subnet", {
      instanceType: new ec2.InstanceType("t3.micro"),
      machineImage: ec2.MachineImage.latestAmazonLinux({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      vpc: vpcA,
      blockDevices: [
        {
          deviceName: "/dev/xvda",
          volume: ec2.BlockDeviceVolume.ebs(8, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
          }),
        },
      ],
      propagateTagsToVolumeOnCreation: true,
      vpcSubnets: vpcA.selectSubnets({
        subnetType: ec2.SubnetType.PUBLIC,
      }),
      role: ssmIamRole,
      securityGroup: vpcAEC2InstanceSG,
    });

    new ec2.Instance(this, "EC2 Instance on VPC A private subnet", {
      instanceType: new ec2.InstanceType("t3.micro"),
      machineImage: ec2.MachineImage.latestAmazonLinux({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      vpc: vpcA,
      blockDevices: [
        {
          deviceName: "/dev/xvda",
          volume: ec2.BlockDeviceVolume.ebs(8, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
          }),
        },
      ],
      propagateTagsToVolumeOnCreation: true,
      vpcSubnets: vpcA.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
      }),
      role: ssmIamRole,
      securityGroup: vpcAEC2InstanceSG,
    });

    new ec2.Instance(this, "EC2 Instance on VPC A isolated subnet", {
      instanceType: new ec2.InstanceType("t3.micro"),
      machineImage: ec2.MachineImage.latestAmazonLinux({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      vpc: vpcA,
      blockDevices: [
        {
          deviceName: "/dev/xvda",
          volume: ec2.BlockDeviceVolume.ebs(8, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
          }),
        },
      ],
      propagateTagsToVolumeOnCreation: true,
      vpcSubnets: vpcA.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      }),
      role: ssmIamRole,
      securityGroup: vpcAEC2InstanceSG,
    });

    new ec2.Instance(this, "EC2 Instance on VPC B public subnet", {
      instanceType: new ec2.InstanceType("t3.micro"),
      machineImage: ec2.MachineImage.latestAmazonLinux({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      vpc: vpcB,
      blockDevices: [
        {
          deviceName: "/dev/xvda",
          volume: ec2.BlockDeviceVolume.ebs(8, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
          }),
        },
      ],
      propagateTagsToVolumeOnCreation: true,
      vpcSubnets: vpcB.selectSubnets({
        subnetType: ec2.SubnetType.PUBLIC,
      }),
      role: ssmIamRole,
      securityGroup: vpcBEC2InstanceSG,
    });
  }
}
